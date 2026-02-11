import { AppSession, ViewType } from '@mentra/sdk';
import { stateMachine } from '../state-machine';
import { queryOpenClaw } from './openclaw';
import { WAKE_WORDS, SLEEP_WORDS, MAX_RESPONSE_LENGTH, RESPONSE_DISPLAY_MS, MIN_CONFIDENCE } from '../config';
import { TranscriptionData, SessionState } from '../types';

/**
 * Clean text for matching (remove punctuation)
 */
function cleanText(text: string): string {
    return text.toLowerCase().replace(/[.,!?'"]/g, '');
}

/**
 * Check if text contains any of the trigger words
 */
function containsTrigger(text: string, triggers: string[]): boolean {
    const cleaned = cleanText(text);
    return triggers.some(t => cleaned.includes(t));
}

/**
 * Extract confidence score from transcription data (if available).
 */
function getConfidence(data: TranscriptionData): number | undefined {
    if (data.confidence !== undefined && data.confidence !== null) {
        return data.confidence;
    }
    const tokens = data.metadata?.soniox?.tokens;
    if (tokens && tokens.length > 0) {
        return tokens.reduce((sum, t) => sum + t.confidence, 0) / tokens.length;
    }
    return undefined;
}

// Minimum utterance duration in ms (filters very brief ambient sounds)
const MIN_DURATION_MS = parseInt(process.env.MIN_DURATION_MS || '500');

let hasLoggedDataShape = false;

/**
 * Check if a transcription looks like background noise vs intentional speech.
 * Uses available heuristics since Soniox doesn't provide confidence scores.
 */
function isLikelyBackgroundNoise(data: TranscriptionData, text: string): string | null {
    // If confidence IS available, use it
    const confidence = getConfidence(data);
    if (confidence !== undefined && confidence < MIN_CONFIDENCE) {
        return `low confidence (${confidence.toFixed(2)} < ${MIN_CONFIDENCE})`;
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
 * Handle transcription events from the glasses
 */
export async function handleTranscription(
    data: TranscriptionData,
    sessionId: string,
    session: AppSession
): Promise<void> {
    // Only process final transcriptions with content
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

    // Check for wake word - only activate if in IDLE state
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

    // Check for sleep word - only deactivate if in LISTENING state
    if (sessionData.state === SessionState.LISTENING && containsTrigger(userText, SLEEP_WORDS)) {
        stateMachine.deactivate(sessionId, 'manual');
        return;
    }

    // If not listening, ignore
    if (!stateMachine.canProcessCommand(sessionId)) {
        console.log(`[Ignored] Not in LISTENING state`);
        return;
    }

    // If already processing, show wait message
    if (stateMachine.isProcessing(sessionId)) {
        console.log(`[Ignored] Already processing a command`);
        session.layouts.showTextWall("⏳ Please wait...", {
            view: ViewType.MAIN,
            durationMs: 1500
        });
        return;
    }

    // Start processing
    stateMachine.startProcessing(sessionId);

    // Show what user said briefly
    session.layouts.showTextWall(`🎤 ${userText.substring(0, 50)}${userText.length > 50 ? '...' : ''}`, {
        view: ViewType.MAIN,
        durationMs: 800
    });

    // Animated dots indicator
    const thinkingFrames = [
        "·",
        "· ·",
        "· · ·",
        "· · · ·",
        "· · ·",
        "· ·",
    ];
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

        // Stop animation
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
        // Return to listening state
        stateMachine.finishProcessing(sessionId);
    }
}
