import { AppSession, ViewType } from '@mentra/sdk';
import { SessionState, SessionData } from './types';
import { AUTO_SLEEP_MS } from './config';

/**
 * State machine for managing session lifecycle
 */
export class SessionStateMachine {
    private sessions = new Map<string, SessionData>();

    /**
     * Initialize a new session in IDLE state
     */
    createSession(sessionId: string, session: AppSession): SessionData {
        const data: SessionData = {
            state: SessionState.IDLE,
            lastActivity: Date.now(),
            session
        };
        this.sessions.set(sessionId, data);
        console.log(`[StateMachine] Session ${sessionId} created in IDLE state`);
        return data;
    }

    /**
     * Get session data
     */
    getSession(sessionId: string): SessionData | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Transition to LISTENING state
     */
    activate(sessionId: string, speakerId?: number | string): boolean {
        const data = this.sessions.get(sessionId);
        if (!data) return false;

        if (data.state === SessionState.IDLE) {
            data.state = SessionState.LISTENING;
            data.lastActivity = Date.now();
            data.activeSpeakerId = speakerId;
            this.startAutoSleepTimer(sessionId, data);
            console.log(`[StateMachine] Session ${sessionId}: IDLE -> LISTENING (speaker: ${speakerId ?? 'unknown'})`);

            data.session.layouts.showTextWall("👂 Listening! How can I help?", {
                view: ViewType.MAIN,
                durationMs: 3000
            });
            return true;
        }
        return false;
    }

    /**
     * Transition to IDLE (sleep) state
     */
    deactivate(sessionId: string, reason: 'manual' | 'auto' = 'manual'): boolean {
        const data = this.sessions.get(sessionId);
        if (!data) return false;

        if (data.state === SessionState.LISTENING || data.state === SessionState.PROCESSING) {
            data.state = SessionState.IDLE;
            data.activeSpeakerId = undefined;
            this.clearAutoSleepTimer(data);
            console.log(`[StateMachine] Session ${sessionId}: ${data.state} -> IDLE (${reason})`);

            const emoji = reason === 'auto' ? '😴' : '💤';
            const message = reason === 'auto'
                ? `${emoji} Auto-sleep... Say 'Hello' to wake`
                : `${emoji} Sleeping... Say 'Hello' to wake`;

            data.session.layouts.showTextWall(message, {
                view: ViewType.MAIN,
                durationMs: 3000
            });
            return true;
        }
        return false;
    }

    /**
     * Transition to PROCESSING state (when handling a command)
     */
    startProcessing(sessionId: string): boolean {
        const data = this.sessions.get(sessionId);
        if (!data) return false;

        if (data.state === SessionState.LISTENING) {
            data.state = SessionState.PROCESSING;
            data.lastActivity = Date.now();
            this.clearAutoSleepTimer(data);
            console.log(`[StateMachine] Session ${sessionId}: LISTENING -> PROCESSING`);
            return true;
        }
        return false;
    }

    /**
     * Finish processing and return to LISTENING state
     */
    finishProcessing(sessionId: string): boolean {
        const data = this.sessions.get(sessionId);
        if (!data) return false;

        if (data.state === SessionState.PROCESSING) {
            data.state = SessionState.LISTENING;
            data.lastActivity = Date.now();
            this.startAutoSleepTimer(sessionId, data);
            console.log(`[StateMachine] Session ${sessionId}: PROCESSING -> LISTENING`);
            return true;
        }
        return false;
    }

    /**
     * Check if session is in a state that allows processing commands
     */
    canProcessCommand(sessionId: string): boolean {
        const data = this.sessions.get(sessionId);
        return data?.state === SessionState.LISTENING;
    }

    /**
     * Check if session is processing (to prevent overlapping requests)
     */
    isProcessing(sessionId: string): boolean {
        const data = this.sessions.get(sessionId);
        return data?.state === SessionState.PROCESSING;
    }

    /**
     * Update last activity timestamp
     */
    touch(sessionId: string): void {
        const data = this.sessions.get(sessionId);
        if (data) {
            data.lastActivity = Date.now();
        }
    }

    /**
     * Remove session (on disconnect)
     */
    removeSession(sessionId: string): void {
        const data = this.sessions.get(sessionId);
        if (data) {
            this.clearAutoSleepTimer(data);
            this.sessions.delete(sessionId);
            console.log(`[StateMachine] Session ${sessionId} removed`);
        }
    }

    /**
     * Start auto-sleep timer
     */
    private startAutoSleepTimer(sessionId: string, data: SessionData): void {
        this.clearAutoSleepTimer(data);
        data.autoSleepTimer = setTimeout(() => {
            if (data.state === SessionState.LISTENING) {
                this.deactivate(sessionId, 'auto');
            }
        }, AUTO_SLEEP_MS);
    }

    /**
     * Clear auto-sleep timer
     */
    private clearAutoSleepTimer(data: SessionData): void {
        if (data.autoSleepTimer) {
            clearTimeout(data.autoSleepTimer);
            data.autoSleepTimer = undefined;
        }
    }
}

// Singleton instance
export const stateMachine = new SessionStateMachine();
