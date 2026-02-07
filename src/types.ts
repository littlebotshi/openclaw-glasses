import { AppSession } from '@mentra/sdk';

// Session state enum
export enum SessionState {
    IDLE = 'idle',
    LISTENING = 'listening',
    PROCESSING = 'processing'
}

// Session data stored per connected glasses
export interface SessionData {
    session: AppSession;
    state: SessionState;
    lastActivity: number;
    sleepTimer: ReturnType<typeof setTimeout> | null;
    activeSpeakerId?: number | string;  // Speaker who triggered wake word
}

// Transcription data from glasses
export interface TranscriptionData {
    text: string;
    isFinal: boolean;
    language?: string;
    confidence?: number;
    startTime?: string;
    endTime?: string;
    metadata?: any;
}

// OpenClaw CLI response format
export interface OpenClawResponse {
    status: string;
    result?: {
        payloads?: Array<{
            text?: string;
        }>;
    };
}
