/**
 * Transcription event handler
 */

import { AppSession, ViewType } from '@mentra/sdk';
import { stateMachine } from '../state-machine';
import { queryOpenClaw } from './openclaw';
import { WAKE_WORDS, SLEEP_WORDS, MAX_RESPONSE_LENGTH, RESPONSE_DISPLAY_MS } from '../config';
import { TranscriptionData, SessionState } from '../types';

/**
 * Clean text for matching
 */
function cleanText(text: string): string {
    return text.toLowerCase().replace(/[.,!?'"]/g, '');
}

/**
 * Check if text contains trigger words
 */
function containsTrigger(text: string, triggers: string[]): boolean {
    const cleaned = cleanText(text);
    return triggers.some(t => cleaned.includes(t));
}

/**
 * Handle transcription events from glasses
 */
export async function handleTranscription(
    data: TranscriptionData,
    sessionId: string,
    session: AppSession
): Promise<void> {
    // Only process final transcriptions
    if (!data.isFinal || !data.text.trim()) {
        return;
    }

    const userText = data.text.trim();
    const sessionData = stateMachine.getSession(sessionId);

    if (!sessionData) {
        console.log(`[Transcription] No session data for ${sessionId}`);
        return;
    }

    console.log(`[Transcription] ${userText} (state: ${sessionData.state})`);

    // Check for wake word
    if (sessionData.state === SessionState.IDLE && containsTrigger(userText, WAKE_WORDS)) {
        stateMachine.activate(sessionId);
        return;
    }

    // Check for sleep word
    if (sessionData.state === SessionState.LISTENING && containsTrigger(userText, SLEEP_WORDS)) {
        stateMachine.deactivate(sessionId, 'manual');
        return;
    }

    // Ignore if not listening
    if (!stateMachine.canProcessCommand(sessionId)) {
        return;
    }

    // Show wait if already processing
    if (stateMachine.isProcessing(sessionId)) {
        session.layouts.showTextWall("⏳ Please wait...", {
            view: ViewType.MAIN,
            durationMs: 1500
        });
        return;
    }

    // Start processing
    stateMachine.startProcessing(sessionId);

    // Show what user said
    session.layouts.showTextWall(`🎤 ${userText.substring(0, 50)}${userText.length > 50 ? '...' : ''}`, {
        view: ViewType.MAIN,
        durationMs: 800
    });

    // Thinking animation
    const thinkingFrames = ["·", "· ·", "· · ·", "· · · ·", "· · ·", "· ·"];
    let frameIndex = 0;
    const animationInterval = setInterval(() => {
        if (stateMachine.isProcessing(sessionId)) {
            session.layouts.showTextWall(thinkingFrames[frameIndex % thinkingFrames.length], {
                view: ViewType.MAIN,
                durationMs: 1000
            });
            frameIndex++;
        } else {
            clearInterval(animationInterval);
        }
    }, 500);

    try {
        // Query OpenClaw
        const response = await queryOpenClaw(userText, sessionId);

        clearInterval(animationInterval);

        // Truncate if needed
        const displayText = response.length > MAX_RESPONSE_LENGTH
            ? response.substring(0, MAX_RESPONSE_LENGTH) + "..."
            : response;

        // Display response
        session.layouts.showTextWall(displayText, {
            view: ViewType.MAIN,
            durationMs: RESPONSE_DISPLAY_MS
        });
    } catch (error) {
        clearInterval(animationInterval);
        console.error('OpenClaw error:', error);
        session.layouts.showTextWall("⚠️ Error getting response", {
            view: ViewType.MAIN,
            durationMs: 3000
        });
    } finally {
        clearInterval(animationInterval);
        stateMachine.finishProcessing(sessionId);
    }
}
