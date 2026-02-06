// Session state enum
export enum SessionState {
    IDLE = 'idle',
    LISTENING = 'listening',
    PROCESSING = 'processing'
}

// Transcription data from glasses
export interface TranscriptionData {
    text: string;
    isFinal: boolean;
    language?: string;
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
