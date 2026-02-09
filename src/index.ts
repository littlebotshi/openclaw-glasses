/**
 * OpenClaw Glasses App
 * 
 * Voice-controlled AI assistant for Even Realities G1 smart glasses.
 * Connects to OpenClaw via WebSocket gateway for fast responses.
 * 
 * See README.md for setup instructions.
 */

import { AppServer, AppSession, ViewType } from '@mentra/sdk';
import { PACKAGE_NAME, MENTRAOS_API_KEY, PORT } from './config';
import { stateMachine } from './state-machine';
import { handleTranscription } from './handlers/transcription';
import * as fs from 'fs';
import * as path from 'path';

// Load app config for settings
const APP_CONFIG_PATH = path.resolve(__dirname, '..', 'app_config.json');
const APP_CONFIG_JSON = fs.readFileSync(APP_CONFIG_PATH, 'utf-8');

// Global error handlers - prevent crashes
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  // Log but don't exit - try to keep running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[WARN] Unhandled rejection at:', promise, 'reason:', reason);
});

/**
 * Main application class
 */
class OpenClawGlassesApp extends AppServer {
  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
    });
  }

  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    console.log(`[Session] New session: ${sessionId} for user: ${userId}`);

    // Load app config (settings schema) and initialize defaults
    // The CONNECTION_ACK may not include settings if the cloud doesn't have them yet,
    // so we load the config and apply defaults as a fallback.
    try {
      session.loadConfigFromJson(APP_CONFIG_JSON);
      const currentSettings = session.settings.getAll();
      if (!currentSettings || currentSettings.length === 0) {
        const defaults = session.getDefaultSettings();
        session.updateSettingsForTesting(defaults);
        console.log(`[Session] App config loaded, applied ${defaults.length} default settings`);
      } else {
        console.log(`[Session] App config loaded, ${currentSettings.length} settings from cloud`);
      }
    } catch (err) {
      console.error(`[Session] Failed to load app config:`, err);
    }

    // Initialize session in state machine
    stateMachine.createSession(sessionId, session);

    // Show welcome message
    session.layouts.showTextWall("🦀 Say 'Hello' to start");

    // Absorb SDK error events to prevent process crashes.
    // The SDK emits errors (connection timeouts, session not found, etc.) on the
    // internal EventEmitter. Without a listener, Node.js crashes the process.
    session.events.onError((err: any) => {
      console.warn(`[Session] SDK error (absorbed): ${err.message || err}`);
    });

    // Handle transcriptions
    session.events.onTranscription(async (data) => {
      await handleTranscription(data, sessionId, session);
    });

    // Listen for mode setting changes
    session.settings.onValueChange<string>('mode', (newMode, oldMode) => {
      console.log(`[Settings] Mode changed: ${oldMode} → ${newMode}`);
      const emoji = newMode === 'commanding' ? '🎯' : '👂';
      session.layouts.showTextWall(`${emoji} Mode: ${newMode}`, {
        view: ViewType.MAIN,
        durationMs: 3000
      });
    });
  }
}

// Start the server
const app = new OpenClawGlassesApp();
app.start().catch(console.error);