/**
 * Transcription event handler
 */

import { AppSession, ViewType } from '@mentra/sdk';
import { stateMachine } from '../state-machine';
import { queryOpenClaw } from './openclaw';
import { WAKE_WORDS, SLEEP_WORDS, MAX_RESPONSE_LENGTH, RESPONSE_DISPLAY_MS } from '../config';
import { TranscriptionData, SessionState } from '../types';

// Minimum utterance duration in ms (filters very brief ambient sounds)
const MIN_DURATION_MS = parseInt(process.env.MIN_DURATION_MS || '500');

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
 * Check if a transcription looks like background noise vs intentional speech.
 * Uses available heuristics (duration, confidence if available).
 */
function isLikelyBackgroundNoise(data: TranscriptionData, text: string): string | null {
    // If confidence IS available, use it
    if (data.confidence !== undefined && data.confidence < 0.85) {
        return `low confidence (${data.confidence.toFixed(2)})`;
    }

    // Heuristic: very short duration utterances are likely ambient
    const startTime = data.startTime ? new Date(data.startTime).getTime() : 0;
    const endTime = data.endTime ? new Date(data.endTime).getTime() : 0;
    const durationMs = endTime - startTime;
    if (durationMs > 0 && durationMs < MIN_DURATION_MS) {
        return `too short (${durationMs}ms < ${MIN_DURATION_MS}ms)`;
    }

    return null; // Not noise
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
    const speakerId = (data as any).speakerId;
    const sessionData = stateMachine.getSession(sessionId);

    if (!sessionData) {
        console.log(`[Transcription] No session data for ${sessionId}`);
        return;
    }

    // Filter background noise (duration/confidence based)
    const noiseReason = isLikelyBackgroundNoise(data, userText);
    if (noiseReason) {
        console.log(`[Transcription] SKIPPED (${noiseReason}): ${userText}`);
        return;
    }

    // Check for wake word
    if (sessionData.state === SessionState.IDLE && containsTrigger(userText, WAKE_WORDS)) {
        console.log(`[Transcription] Wake word detected from speaker ${speakerId}: "${userText}"`);
        stateMachine.activate(sessionId, speakerId);
        return;
    }

    // Speaker lock: in commanding mode, only process the speaker who triggered wake word
    const mode = session.settings.get<string>('mode', 'commanding');
    if (mode === 'commanding' && sessionData.state !== SessionState.IDLE && sessionData.activeSpeakerId !== undefined) {
        if (speakerId !== sessionData.activeSpeakerId) {
            console.log(`[Transcription] IGNORED (speaker ${speakerId} != active speaker ${sessionData.activeSpeakerId}): ${userText}`);
            return;
        }
    }

    console.log(`[Transcription] speaker=${speakerId} "${userText}" (state: ${sessionData.state})`);

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
