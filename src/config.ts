import 'dotenv/config';

// MentraOS Configuration
export const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
export const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
export const PORT = parseInt(process.env.PORT || '3000');

// Display settings
export const MAX_RESPONSE_LENGTH = parseInt(process.env.MAX_RESPONSE_LENGTH || '150');
export const RESPONSE_DISPLAY_MS = parseInt(process.env.RESPONSE_DISPLAY_MS || '10000');

// Sensitivity - minimum transcription confidence to process (0.0-1.0)
// Lower = more sensitive (picks up more), higher = stricter (filters more)
export const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE || '0.85');

// Timing
export const AUTO_SLEEP_MS = parseInt(process.env.AUTO_SLEEP_MS || '30000');
export const COMMAND_TIMEOUT_MS = parseInt(process.env.COMMAND_TIMEOUT_MS || '15000');

// AI prompt
export const GLASSES_PROMPT = process.env.GLASSES_PROMPT ||
    'User is on smart glasses. Keep responses under 150 characters. Be helpful and natural, but concise enough to read on a small display.';

// Wake words - triggers listening mode
export const WAKE_WORDS = [
    'hello bot', 'hi bot', 'hey bot', 'ok bot', 'okay bot',
    'hello robot', 'hi robot', 'hey robot',
    'hello', 'hi there', 'hey there',
    'wake up', 'im here', 'i am here'
];

// Sleep words - deactivates listening mode
export const SLEEP_WORDS = [
    'go to sleep', 'sleep', 'stop listening', 'bye', 'goodbye',
    'good night', 'stop', 'thats all', 'thanks bye', 'thank you bye',
    'nevermind', 'never mind', 'cancel'
];
