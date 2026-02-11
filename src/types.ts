import { AppSession } from '@mentra/sdk';

/**
 * Session states as a finite state machine
 */
export enum SessionState {
    IDLE = 'IDLE',           // Not listening, waiting for wake word
    LISTENING = 'LISTENING', // Actively listening for commands
    PROCESSING = 'PROCESSING' // Processing a command (waiting for OpenClaw response)
}

/**
 * Session data stored per connected glasses
 */
export interface SessionData {
    state: SessionState;
    lastActivity: number;
    session: AppSession;
    autoSleepTimer?: NodeJS.Timeout;
    activeSpeakerId?: number | string;  // Speaker who triggered wake word
}

/**
 * Transcription event data - re-exported from SDK (includes confidence, metadata, etc.)
 */
export type { TranscriptionData } from '@mentra/sdk';

/**
 * OpenClaw API response structure
 */
export interface OpenClawResponse {
    status: 'ok' | 'error';
    result?: {
        payloads?: Array<{
            text: string;
            mediaUrl?: string | null;
        }>;
        meta?: {
            durationMs: number;
            agentMeta?: {
                sessionId: string;
                provider: string;
                model: string;
            };
        };
    };
    error?: string;
}
