import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { generateKeyPairSync, sign } from 'crypto';

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://localhost:18789';
// Use CLI's identity directory (where the paired device keys are stored)
const IDENTITY_DIR = join(homedir(), '.openclaw', 'identity');
const DEVICE_FILE = join(IDENTITY_DIR, 'device.json');
const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json');

/**
 * Load gateway password from openclaw.json
 */
function loadGatewayPassword(): string | null {
    try {
        const data = readFileSync(OPENCLAW_CONFIG, 'utf-8');
        const config = JSON.parse(data);
        return config.gateway?.auth?.token || config.gateway?.auth?.password || null;
    } catch {
        return null;
    }
}

const DEVICE_AUTH_FILE = join(homedir(), '.openclaw', 'identity', 'device-auth.json');

/**
 * Load device auth token from device-auth.json
 */
function loadDeviceAuthToken(): string | null {
    try {
        const data = readFileSync(DEVICE_AUTH_FILE, 'utf-8');
        const auth = JSON.parse(data);
        return auth.tokens?.operator?.token || null;
    } catch {
        return null;
    }
}

interface DeviceIdentity {
    deviceId: string;
    publicKeyPem: string;
    privateKeyPem: string;
    token?: string;
    createdAt: number;
}

interface GatewayResponse {
    type: 'res' | 'event';
    id?: string;
    ok?: boolean;
    payload?: any;
    error?: { message: string; code?: string };
    event?: string;
}

interface PendingRequest {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
}

/**
 * Generate a new Ed25519 keypair for device identity
 */
function generateDeviceIdentity(): DeviceIdentity {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    // Generate device ID from public key hash
    const crypto = require('crypto');
    const deviceId = crypto.createHash('sha256')
        .update(publicKey)
        .digest('hex');

    return {
        deviceId,
        publicKeyPem: publicKey,
        privateKeyPem: privateKey,
        createdAt: Date.now()
    };
}

/**
 * Load or create device identity
 */
function loadOrCreateDeviceIdentity(): DeviceIdentity {
    try {
        if (existsSync(DEVICE_FILE)) {
            const data = readFileSync(DEVICE_FILE, 'utf-8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.log('[Device] Failed to load existing identity:', e);
    }

    // Create new identity
    console.log('[Device] Generating new device identity...');
    const identity = generateDeviceIdentity();

    // Save it
    if (!existsSync(IDENTITY_DIR)) {
        mkdirSync(IDENTITY_DIR, { recursive: true });
    }
    writeFileSync(DEVICE_FILE, JSON.stringify(identity, null, 2));
    console.log('[Device] Saved new identity to', DEVICE_FILE);

    return identity;
}

/**
 * Save updated device identity (with token)
 */
function saveDeviceIdentity(identity: DeviceIdentity): void {
    if (!existsSync(IDENTITY_DIR)) {
        mkdirSync(IDENTITY_DIR, { recursive: true });
    }
    writeFileSync(DEVICE_FILE, JSON.stringify(identity, null, 2));
}

/**
 * Sign a message with Ed25519 private key (returns base64url)
 */
function signMessage(privateKeyPem: string, message: string): string {
    const signature = sign(null, Buffer.from(message), privateKeyPem);
    // Convert to base64url
    return signature.toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

/**
 * Extract raw 32-byte Ed25519 public key from PEM and convert to base64url
 * SPKI format is 44 bytes: 12 byte header + 32 byte raw key
 */
function extractPublicKeyRaw(publicKeyPem: string): string {
    // Remove PEM headers and newlines
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
    private needsPairing = false;
    private gatewayPassword: string | null;

    // Reconnection state
    private reconnectAttempts = 0;
    private reconnectBackoffMs = 1000;
    private maxBackoffMs = 30000;
    private reconnecting = false;
    private lastConnectedAt = 0;

    constructor(sessionKey: string = 'glasses-session') {
        this.sessionKey = sessionKey;
        this.device = loadOrCreateDeviceIdentity();
        this.gatewayPassword = loadGatewayPassword();
        if (this.gatewayPassword) {
            console.log('[Gateway] Found gateway password in config');
        }
    }

    setSessionKey(key: string): void {
        this.sessionKey = key;
    }

    async connect(): Promise<void> {
        if (this.connected) return;
        if (this.connectPromise) return this.connectPromise;

        this.connectPromise = new Promise((resolve, reject) => {
            console.log(`[Gateway] Connecting to ${GATEWAY_URL}...`);

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
                        this.lastConnectedAt = Date.now();
                        console.log('[Gateway] ✅ Connected and authenticated!');
                        resolve();
                    } catch (err: any) {
                        if (err.message?.includes('NOT_PAIRED')) {
                            this.needsPairing = true;
                            console.log('[Gateway] Device not paired, requesting pairing...');
                            try {
                                await this.requestPairing();
                                console.log('[Gateway] 📱 Pairing requested! Check OpenClaw web UI to approve.');
                                reject(new Error('PAIRING_REQUIRED: Check OpenClaw web UI to approve the glasses app'));
                            } catch (pairErr) {
                                reject(pairErr);
                            }
                        } else {
                            reject(err);
                        }
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

                // Schedule reconnection if not already reconnecting
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
     * Schedule a reconnection attempt with exponential backoff.
     * Retries indefinitely — the gateway will come back once launchd restarts it.
     */
    private scheduleReconnect(): void {
        this.reconnecting = true;

        // If we were connected for more than 60s before disconnecting,
        // reset the backoff since this is a fresh disconnection (e.g. WiFi drop)
        if (this.lastConnectedAt > 0 && (Date.now() - this.lastConnectedAt) > 60_000) {
            this.reconnectAttempts = 0;
        }

        const delay = Math.min(
            this.reconnectBackoffMs * Math.pow(2, this.reconnectAttempts),
            this.maxBackoffMs
        );

        console.log(`[Gateway] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

        setTimeout(async () => {
            this.reconnectAttempts++;
            try {
                await this.connect();
                console.log('[Gateway] Reconnected successfully');
                this.reconnectAttempts = 0; // Reset on success
                this.reconnecting = false;
            } catch (err) {
                console.error('[Gateway] Reconnect failed:', err);
                this.scheduleReconnect();
            }
        }, delay);
    }

    /**
     * Send signed connect request with device identity
     */
    private async sendSignedConnect(): Promise<any> {
        const signedAtMs = Date.now();
        const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing'];
        const role = 'operator';
        // Load auth token from device-auth.json (not device.json)
        const token = loadDeviceAuthToken() || '';

        // Build signature message
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

        const signature = signMessage(this.device.privateKeyPem, signatureMessage);


        return this.request('connect', {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
                id: 'cli',
                version: '1.0.0',
                platform: 'node',
                mode: 'backend',
                instanceId: uuidv4()
            },
            role: role,
            scopes: scopes,
            auth: {
                password: this.gatewayPassword || undefined,
                token: token || undefined
            },
            device: {
                id: this.device.deviceId,
                publicKey: extractPublicKeyRaw(this.device.publicKeyPem),
                signature: signature,
                signedAt: signedAtMs,
                nonce: this.connectNonce
            },
            caps: [],
            userAgent: 'glasses-app/1.0.0'
        });
    }

    /**
     * Request pairing approval from the gateway
     */
    private async requestPairing(): Promise<void> {
        // First, we need to register as a pending pairing request
        // This should show up in the OpenClaw web UI
        console.log('[Gateway] Device ID:', this.device.deviceId.substring(0, 16) + '...');
        console.log('[Gateway] Open OpenClaw web UI (http://localhost:18789) and approve the new device');

        // The pairing flow is:
        // 1. We try to connect (fails with NOT_PAIRED)
        // 2. Our device ID + public key are now in the pending list
        // 3. User approves in web UI
        // 4. We get a token back
        // 5. Next connect will work with the token

        // For now, just inform the user they need to approve
    }

    async sendMessage(message: string, timeoutMs: number = 30000): Promise<string> {
        await this.connect();

        const idempotencyKey = uuidv4();
        const startTime = Date.now();

        console.log(`[Gateway] Sending chat.send...`);

        return new Promise((resolve, reject) => {
            // Start the chat
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

            // Listen for events related to this chat
            const eventHandler = (data: Buffer | string) => {
                try {
                    const msg = JSON.parse(data.toString());

                    // Handle the initial chat.send response
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

                        // Match on runId only — sessionKey may differ between connect and chat
                        if (payload?.runId !== runId) {
                            return;
                        }

                        // Capture text from agent assistant stream
                        if (msg.event === 'agent' && payload?.stream === 'assistant' && payload?.data?.text) {
                            fullText = payload.data.text; // Use full text, not delta
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

            // Send the chat request
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

    private request(method: string, params: any, timeoutMs: number = 10000): Promise<any> {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('Gateway not connected'));
                return;
            }

            const id = uuidv4();
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Request ${method} timed out`));
            }, timeoutMs);

            this.pending.set(id, { resolve, reject, timeout });

            const msg = JSON.stringify({
                type: 'req',
                id: id,
                method: method,
                params: params
            });

            this.ws.send(msg);
        });
    }

    private handleMessage(data: string): GatewayResponse | null {
        let msg: GatewayResponse;
        try {
            msg = JSON.parse(data);
        } catch {
            return null;
        }

        if (msg.type === 'res' && msg.id) {
            const pending = this.pending.get(msg.id);
            if (pending) {
                this.pending.delete(msg.id);
                clearTimeout(pending.timeout);
                if (msg.ok) {
                    pending.resolve(msg.payload);
                } else {
                    const errorCode = msg.error?.code || '';
                    pending.reject(new Error(`${errorCode}: ${msg.error?.message || 'Request failed'}`));
                }
            }
        }

        return msg;
    }

    close(): void {
        this.ws?.close();
        this.ws = null;
        this.connected = false;
    }
}

let gatewayClient: GatewayClient | null = null;

export function getGatewayClient(sessionKey?: string): GatewayClient {
    if (!gatewayClient) {
        gatewayClient = new GatewayClient(sessionKey);
    } else if (sessionKey) {
        gatewayClient.setSessionKey(sessionKey);
    }
    return gatewayClient;
}

export function resetGatewayClient(): void {
    gatewayClient?.close();
    gatewayClient = null;
}
