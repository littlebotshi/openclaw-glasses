/**
 * State machine for managing glasses session lifecycle
 */

import { AppSession } from '@mentra/sdk';
import { SessionState } from './types';
import { AUTO_SLEEP_MS, RESPONSE_DISPLAY_MS } from './config';

interface SessionData {
    session: AppSession;
    state: SessionState;
    lastActivity: number;
    sleepTimer: ReturnType<typeof setTimeout> | null;
}

class StateMachine {
    private sessions = new Map<string, SessionData>();

    createSession(sessionId: string, session: AppSession): void {
        this.sessions.set(sessionId, {
            session,
            state: SessionState.IDLE,
            lastActivity: Date.now(),
            sleepTimer: null
        });
    }

    getSession(sessionId: string): SessionData | undefined {
        return this.sessions.get(sessionId);
    }

    activate(sessionId: string): void {
        const data = this.sessions.get(sessionId);
        if (!data) return;

        data.state = SessionState.LISTENING;
        data.lastActivity = Date.now();
        this.resetSleepTimer(sessionId);

        data.session.layouts.showTextWall("👂 Listening! What can I help with?", {
            durationMs: 2000
        });
        console.log(`[State] ${sessionId} -> LISTENING`);
    }

    deactivate(sessionId: string, reason: 'manual' | 'auto' = 'manual'): void {
        const data = this.sessions.get(sessionId);
        if (!data) return;

        data.state = SessionState.IDLE;
        this.clearSleepTimer(sessionId);

        const message = reason === 'auto'
            ? "😴 Auto-sleep... Say 'Hello' to wake"
            : "😴 Sleeping... Say 'Hello' to wake";

        data.session.layouts.showTextWall(message, {
            durationMs: 2000
        });
        console.log(`[State] ${sessionId} -> IDLE (${reason})`);
    }

    canProcessCommand(sessionId: string): boolean {
        const data = this.sessions.get(sessionId);
        return data?.state === SessionState.LISTENING;
    }

    isProcessing(sessionId: string): boolean {
        const data = this.sessions.get(sessionId);
        return data?.state === SessionState.PROCESSING;
    }

    startProcessing(sessionId: string): void {
        const data = this.sessions.get(sessionId);
        if (data) {
            data.state = SessionState.PROCESSING;
            data.lastActivity = Date.now();
            this.clearSleepTimer(sessionId);
        }
    }

    finishProcessing(sessionId: string): void {
        const data = this.sessions.get(sessionId);
        if (data) {
            data.state = SessionState.LISTENING;
            data.lastActivity = Date.now();
            this.resetSleepTimer(sessionId);
        }
    }

    private resetSleepTimer(sessionId: string): void {
        this.clearSleepTimer(sessionId);
        const data = this.sessions.get(sessionId);
        if (!data) return;

        data.sleepTimer = setTimeout(() => {
            if (data.state === SessionState.LISTENING) {
                this.deactivate(sessionId, 'auto');
            }
        }, AUTO_SLEEP_MS);
    }

    private clearSleepTimer(sessionId: string): void {
        const data = this.sessions.get(sessionId);
        if (data?.sleepTimer) {
            clearTimeout(data.sleepTimer);
            data.sleepTimer = null;
        }
    }

    removeSession(sessionId: string): void {
        this.clearSleepTimer(sessionId);
        this.sessions.delete(sessionId);
    }
}

export const stateMachine = new StateMachine();
