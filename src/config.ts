import 'dotenv/config';

// MentraOS Configuration
export const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
export const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
export const PORT = parseInt(process.env.PORT || '3000');

// Display settings
export const MAX_RESPONSE_LENGTH = parseInt(process.env.MAX_RESPONSE_LENGTH || '150');
export const RESPONSE_DISPLAY_MS = parseInt(process.env.RESPONSE_DISPLAY_MS || '10000');

// Timing
export const AUTO_SLEEP_MS = parseInt(process.env.AUTO_SLEEP_MS || '30000');
export const COMMAND_TIMEOUT_MS = parseInt(process.env.COMMAND_TIMEOUT_MS || '30000');

// AI prompt - optimized for glasses display
export const GLASSES_PROMPT = process.env.GLASSES_PROMPT ||
    'User is on smart glasses. Keep responses under 150 characters. Be helpful and natural, but concise enough to read on a small display.';

// Wake words - triggers listening mode
export const WAKE_WORDS = [
    'hey claw', 'hey openclaw', 'ok claw', 'hello claw',
    'hello bot', 'hi bot', 'hey bot', 'ok bot',
    'hello', 'hi there', 'hey there',
    'wake up'
];

// Sleep words - deactivates listening mode
export const SLEEP_WORDS = [
    'go to sleep', 'sleep', 'stop listening', 'bye', 'goodbye',
    'good night', 'stop', 'thats all', 'thanks bye', 'thank you bye',
    'nevermind', 'never mind', 'cancel',
    // Chinese
    '再见', '拜拜', '晚安', '睡觉', '停止'
];
