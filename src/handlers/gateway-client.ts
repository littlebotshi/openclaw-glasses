/**
 * OpenClaw Gateway WebSocket Client
 * 
 * Provides fast, direct WebSocket connection to OpenClaw's gateway server.
 * Falls back to CLI if gateway is unavailable.
 * 
 * Authentication uses Ed25519 device identity (created by OpenClaw CLI).
 */

import * as crypto from 'crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';

// Gateway URL - defaults to local, can override via env
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://localhost:18789';

// Path to OpenClaw identity files (created by CLI)
const IDENTITY_DIR = join(homedir(), '.openclaw', 'identity');
const DEVICE_FILE = join(IDENTITY_DIR, 'device.json');
const DEVICE_AUTH_FILE = join(IDENTITY_DIR, 'device-auth.json');
const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json');

interface DeviceIdentity {
    deviceId: string;
    publicKey: string;
    privateKey: string;
}

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

interface GatewayResponse {
    type: string;
    id?: string;
    ok?: boolean;
    error?: { code: string; message: string };
    payload?: any;
    event?: string;
}

/**
 * Load or create device identity
 */
function loadOrCreateDeviceIdentity(): DeviceIdentity {
    // Try to load existing identity from OpenClaw CLI
    if (existsSync(DEVICE_FILE)) {
        try {
            const data = JSON.parse(readFileSync(DEVICE_FILE, 'utf-8'));
            if (data.deviceId && data.publicKey && data.privateKey) {
                console.log('[Gateway] Loaded existing device identity');
                return data;
            }
        } catch {
            // Fall through to create new
        }
    }

    // Create new keypair if none exists
    console.log('[Gateway] Creating new device identity');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    // Derive device ID from public key hash
    const rawKey = publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
    const deviceId = crypto.createHash('sha256').update(rawKey).digest('hex');

    const identity: DeviceIdentity = {
        deviceId,
        publicKey: publicKeyPem,
        privateKey: privateKeyPem
    };

    // Save for future use
    if (!existsSync(IDENTITY_DIR)) {
        mkdirSync(IDENTITY_DIR, { recursive: true });
    }
    writeFileSync(DEVICE_FILE, JSON.stringify(identity, null, 2));

    return identity;
}

/**
 * Load gateway password from OpenClaw config
 */
function loadGatewayPassword(): string | null {
    try {
        if (existsSync(OPENCLAW_CONFIG)) {
            const config = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf-8'));
            return config.gateway?.auth?.token || null;
        }
    } catch {
        // Ignore
    }
    return null;
}

/**
 * Load device auth token (from pairing)
 */
function loadDeviceAuthToken(): string | null {
    try {
        if (existsSync(DEVICE_AUTH_FILE)) {
            const data = JSON.parse(readFileSync(DEVICE_AUTH_FILE, 'utf-8'));
            return data.deviceToken || null;
        }
    } catch {
        // Ignore
    }
    return null;
}

/**
 * Extract raw 32-byte Ed25519 key from PEM
 */
function extractPublicKeyRaw(publicKeyPem: string): string {
    const base64 = publicKeyPem
        .replace(/-----BEGIN PUBLIC KEY-----/g, '')
        .replace(/-----END PUBLIC KEY-----/g, '')
        .replace(/\n/g, '')
        .trim();

    // Decode SPKI and extract last 32 bytes (raw Ed25519 key)
    const spkiBuffer = Buffer.from(base64, 'base64');
    const rawKey = spkiBuffer.slice(-32);

    // Convert to base64url
    return rawKey.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

/**
 * WebSocket client for direct gateway communication
 */
export class GatewayClient {
    private ws: WebSocket | null = null;
    private pending = new Map<string, PendingRequest>();
    private connected = false;
    private connectPromise: Promise<void> | null = null;
    private sessionKey: string;
    private device: DeviceIdentity;
    private connectNonce: string | null = null;
    private gatewayPassword: string | null;

    // Reconnection state
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private reconnectBackoffMs = 1000;
    private maxBackoffMs = 30000;
    private reconnecting = false;

    constructor(sessionKey: string = 'glasses-session') {
        this.sessionKey = sessionKey;
        this.device = loadOrCreateDeviceIdentity();
        this.gatewayPassword = loadGatewayPassword();
        if (this.gatewayPassword) {
            console.log('[Gateway] Found gateway password in config');
        }
    }

    /**
     * Connect to gateway
     */
    async connect(): Promise<void> {
        if (this.connected && this.ws) {
            return;
        }

        if (this.connectPromise) {
            return this.connectPromise;
        }

        console.log(`[Gateway] Connecting to ${GATEWAY_URL}...`);

        this.connectPromise = new Promise((resolve, reject) => {
            this.ws = new WebSocket(GATEWAY_URL);

            this.ws.on('open', () => {
                console.log('[Gateway] WebSocket connected, waiting for challenge...');
            });

            this.ws.on('message', async (data) => {
                const msg = this.handleMessage(data.toString());

                // Handle connect challenge
                if (msg?.type === 'event' && msg.event === 'connect.challenge') {
                    this.connectNonce = (msg as any).payload?.nonce || null;
                    console.log('[Gateway] Received challenge, signing...');
                    try {
                        await this.sendSignedConnect();
                        this.connected = true;
                        console.log('[Gateway] ✅ Connected and authenticated!');
                        resolve();
                    } catch (err: any) {
                        reject(err);
                    }
                }
            });

            this.ws.on('close', () => {
                console.log('[Gateway] WebSocket closed');
                this.connected = false;
                this.ws = null;
                this.connectPromise = null;
                for (const [id, req] of this.pending) {
                    clearTimeout(req.timeout);
                    req.reject(new Error('Gateway connection closed'));
                }
                this.pending.clear();

                // Schedule reconnection
                if (!this.reconnecting) {
                    this.scheduleReconnect();
                }
            });

            this.ws.on('error', (err) => {
                console.error('[Gateway] WebSocket error:', err);
                reject(err);
            });

            setTimeout(() => {
                if (!this.connected) {
                    reject(new Error('Connection timeout'));
                    this.ws?.close();
                }
            }, 15000);
        });

        return this.connectPromise;
    }

    /**
     * Schedule reconnection with exponential backoff
     */
    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('[Gateway] Max reconnect attempts reached');
            this.reconnecting = false;
            return;
        }

        this.reconnecting = true;
        const delay = Math.min(
            this.reconnectBackoffMs * Math.pow(2, this.reconnectAttempts),
            this.maxBackoffMs
        );

        console.log(`[Gateway] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);

        setTimeout(async () => {
            this.reconnectAttempts++;
            try {
                await this.connect();
                console.log('[Gateway] Reconnected successfully');
                this.reconnectAttempts = 0;
                this.reconnecting = false;
            } catch (err) {
                console.error('[Gateway] Reconnect failed:', err);
                this.scheduleReconnect();
            }
        }, delay);
    }

    /**
     * Send signed connect request
     */
    private async sendSignedConnect(): Promise<any> {
        const signedAtMs = Date.now();
        const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing'];
        const role = 'operator';
        const token = loadDeviceAuthToken() || '';

        // Build signature payload
        const signatureMessage = [
            'v2',
            this.device.deviceId,
            'cli',
            'backend',
            role,
            scopes.join(','),
            String(signedAtMs),
            token,
            this.connectNonce || ''
        ].join('|');

        // Sign with private key
        const privateKey = crypto.createPrivateKey(this.device.privateKey);
        const signature = crypto.sign(null, Buffer.from(signatureMessage, 'utf8'), privateKey);
        const signatureBase64Url = signature.toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');

        const rawPublicKey = extractPublicKeyRaw(this.device.publicKey);

        return this.request('connect', {
            auth: {
                password: this.gatewayPassword || undefined,
                token: token || undefined
            },
            session: {
                key: this.sessionKey,
                resume: false
            },
            device: {
                id: this.device.deviceId,
                publicKey: rawPublicKey,
                signature: signatureBase64Url,
                signedAtMs,
                role,
                scopes
            },
            client: {
                id: 'glasses-app',
                mode: 'backend',
                version: '1.0.0'
            }
        }, 15000);
    }

    /**
     * Send a message and get AI response
     */
    async sendMessage(message: string, timeoutMs: number = 30000): Promise<string> {
        await this.connect();

        const idempotencyKey = uuidv4();
        const startTime = Date.now();

        console.log(`[Gateway] Sending chat.send...`);

        return new Promise((resolve, reject) => {
            const reqId = uuidv4();
            let runId: string | null = null;
            let fullText = '';
            let completed = false;

            const timeout = setTimeout(() => {
                if (!completed) {
                    completed = true;
                    reject(new Error('Chat response timeout'));
                }
            }, timeoutMs);

            const eventHandler = (data: Buffer | string) => {
                try {
                    const msg = JSON.parse(data.toString());

                    // Handle initial response
                    if (msg.type === 'res' && msg.id === reqId) {
                        if (msg.ok) {
                            runId = msg.payload?.runId;
                            console.log(`[Gateway] Chat started, runId: ${runId?.substring(0, 8)}...`);
                        } else {
                            clearTimeout(timeout);
                            completed = true;
                            this.ws?.removeListener('message', eventHandler);
                            reject(new Error(msg.error?.message || 'Chat failed'));
                        }
                        return;
                    }

                    // Handle streaming events
                    if (msg.type === 'event' && runId) {
                        const payload = msg.payload;

                        if (payload?.runId !== runId || payload?.sessionKey !== this.sessionKey) {
                            return;
                        }

                        // Capture text from assistant stream
                        if (msg.event === 'agent' && payload?.stream === 'assistant' && payload?.data?.text) {
                            fullText = payload.data.text;
                        }

                        // Check for completion
                        if (msg.event === 'chat' && payload?.state === 'final') {
                            clearTimeout(timeout);
                            completed = true;
                            this.ws?.removeListener('message', eventHandler);
                            console.log(`[Gateway] Response in ${Date.now() - startTime}ms`);
                            resolve(fullText || 'No response');
                        }
                    }
                } catch {
                    // Ignore parse errors
                }
            };

            this.ws?.on('message', eventHandler);

            // Send request
            this.ws?.send(JSON.stringify({
                type: 'req',
                id: reqId,
                method: 'chat.send',
                params: {
                    sessionKey: this.sessionKey,
                    message: message,
                    deliver: false,
                    idempotencyKey: idempotencyKey
                }
            }));
        });
    }

    /**
     * Send request and wait for response
     */
    private request(method: string, params: any, timeoutMs: number = 10000): Promise<any> {
        return new Promise((resolve, reject) => {
            const id = uuidv4();

            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Request timeout: ${method}`));
            }, timeoutMs);

            this.pending.set(id, { resolve, reject, timeout });

            this.ws?.send(JSON.stringify({
                type: 'req',
                id,
                method,
                params
            }));
        });
    }

    /**
     * Handle incoming message
     */
    private handleMessage(data: string): GatewayResponse | null {
        try {
            const msg: GatewayResponse = JSON.parse(data);

            // Handle response to pending request
            if (msg.type === 'res' && msg.id) {
                const pending = this.pending.get(msg.id);
                if (pending) {
                    this.pending.delete(msg.id);
                    clearTimeout(pending.timeout);

                    if (msg.ok) {
                        pending.resolve(msg.payload);
                    } else {
                        pending.reject(new Error(`${msg.error?.code}: ${msg.error?.message}`));
                    }
                }
            }

            return msg;
        } catch {
            return null;
        }
    }

    /**
     * Close connection
     */
    close(): void {
        this.ws?.close();
        this.ws = null;
        this.connected = false;
        this.connectPromise = null;
    }
}

// Singleton instance
let gatewayClient: GatewayClient | null = null;

export function getGatewayClient(sessionKey?: string): GatewayClient {
    if (!gatewayClient) {
        gatewayClient = new GatewayClient(sessionKey);
    }
    return gatewayClient;
}

export function resetGatewayClient(): void {
    gatewayClient?.close();
    gatewayClient = null;
}
