/**
 * OpenClaw Glasses App
 * 
 * Voice-controlled AI assistant for Even Realities G1 smart glasses.
 * Connects to OpenClaw via WebSocket gateway for fast responses.
 * 
 * See README.md for setup instructions.
 */

import { AppServer, AppSession } from '@mentra/sdk';
import { PACKAGE_NAME, MENTRAOS_API_KEY, PORT } from './config';
import { stateMachine } from './state-machine';
import { handleTranscription } from './handlers/transcription';

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

    // Initialize session in state machine
    stateMachine.createSession(sessionId, session);

    // Show welcome message
    session.layouts.showTextWall("🦀 Say 'Hello' to start");

    // Handle transcriptions
    session.events.onTranscription(async (data) => {
      await handleTranscription(data, sessionId, session);
    });
  }
}

// Start the server
const app = new OpenClawGlassesApp();
app.start().catch(console.error);