import 'dotenv/config';
import { AppServer, AppSession, ViewType } from '@mentra/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PACKAGE_NAME = process.env.PACKAGE_NAME ?? (() => { throw new Error('PACKAGE_NAME is not set in .env file'); })();
const MENTRAOS_API_KEY = process.env.MENTRAOS_API_KEY ?? (() => { throw new Error('MENTRAOS_API_KEY is not set in .env file'); })();
const PORT = parseInt(process.env.PORT || '3000');

class OpenClawGlassesApp extends AppServer {

  constructor() {
    super({
      packageName: PACKAGE_NAME,
      apiKey: MENTRAOS_API_KEY,
      port: PORT,
    });
  }

  private sessionStates = new Map<string, { listening: boolean; lastCommand: number }>();

  protected async onSession(session: AppSession, sessionId: string, userId: string): Promise<void> {
    // Initialize session state - NOT listening by default to save battery
    this.sessionStates.set(sessionId, { listening: false, lastCommand: 0 });

    // Show welcome message
    session.layouts.showTextWall("🦀 Say 'Hey Claw' to activate");

    // Handle real-time transcription
    session.events.onTranscription(async (data) => {
      if (data.isFinal && data.text.trim()) {
        const userText = data.text.trim().toLowerCase();
        const state = this.sessionStates.get(sessionId)!;
        console.log(`[Transcription] ${data.text.trim()} (listening: ${state.listening})`);

        // Check for wake word
        const wakeWords = ['hey claw', 'hey openclaw', 'ok claw'];
        const hasWakeWord = wakeWords.some(w => userText.includes(w));

        // Check for sleep command
        const sleepWords = ['go to sleep', 'sleep', 'stop listening', 'bye'];
        const hasSleepWord = sleepWords.some(w => userText.includes(w));

        if (hasSleepWord && state.listening) {
          state.listening = false;
          session.layouts.showTextWall("😴 Sleeping... Say 'Hey Claw' to wake", {
            view: ViewType.MAIN,
            durationMs: 3000
          });
          return;
        }

        if (hasWakeWord) {
          state.listening = true;
          state.lastCommand = Date.now();
          session.layouts.showTextWall("👂 Listening! What can I help with?", {
            view: ViewType.MAIN,
            durationMs: 2000
          });
          return;
        }

        // Auto-sleep after 30 seconds of inactivity
        if (state.listening && Date.now() - state.lastCommand > 30000) {
          state.listening = false;
          session.layouts.showTextWall("😴 Auto-sleep... Say 'Hey Claw' to wake", {
            view: ViewType.MAIN,
            durationMs: 2000
          });
          return;
        }

        // Only process if we're listening
        if (!state.listening) {
          return; // Ignore - saves battery
        }

        state.lastCommand = Date.now();

        // Show what user said
        session.layouts.showTextWall(`🎤 ${data.text.trim()}`, {
          view: ViewType.MAIN,
          durationMs: 2000
        });

        try {
          // Send to OpenClaw via CLI
          const response = await this.queryOpenClaw(data.text.trim(), sessionId);

          // Display response on glasses (max 150 chars for readability)
          const displayText = response.length > 150
            ? response.substring(0, 150) + "..."
            : response;

          session.layouts.showTextWall(displayText, {
            view: ViewType.MAIN,
            durationMs: 15000
          });
        } catch (error) {
          console.error('OpenClaw error:', error);
          session.layouts.showTextWall("⚠️ Error: " + (error as Error).message, {
            view: ViewType.MAIN,
            durationMs: 3000
          });
        }
      }
    });

    session.events.onGlassesBattery((data) => {
      console.log('Glasses battery:', data);
    });
  }

  private async queryOpenClaw(message: string, sessionId: string): Promise<string> {
    // System prompt for glasses - request short responses
    const glassesPrompt = "IMPORTANT: User is on smart glasses with tiny display. Keep ALL responses under 100 characters. Be extremely concise. No markdown, no lists.";
    const fullMessage = `${glassesPrompt} User: ${message}`;
    const escapedMessage = fullMessage.replace(/"/g, '\\"').replace(/'/g, "\\'");

    try {
      const { stdout, stderr } = await execAsync(
        `openclaw agent -m "${escapedMessage}" --session-id "glasses-${sessionId}" 2>&1`,
        { timeout: 60000 }
      );

      // Parse the response - remove ANSI codes and formatting
      let response = stdout + stderr;
      response = response.replace(/\x1b\[[0-9;]*m/g, ''); // Remove ANSI
      response = response.replace(/^[│├└┌┐┘┬┴┤├─]+.*$/gm, ''); // Remove box chars
      response = response.replace(/^.*DEP[0-9]+.*$/gm, ''); // Remove deprecation warnings
      response = response.replace(/^.*DeprecationWarning.*$/gm, ''); // Remove deprecation text
      response = response.replace(/^.*punycode.*$/gmi, ''); // Remove punycode warnings
      response = response.replace(/^\(node:[0-9]+\).*$/gm, ''); // Remove node process warnings
      response = response.replace(/^.*\(use.*node.*--trace.*$/gmi, ''); // Remove node trace hints
      response = response.replace(/^\s*$/gm, '').trim();

      // Extract just the agent's response text
      const lines = response.split('\n').filter(l => l.trim());

      // Return last substantial lines (likely the response)
      if (lines.length > 0) {
        return lines.slice(-3).join('\n');
      }

      return response || 'No response from agent';
    } catch (error: any) {
      if (error.stdout) {
        return error.stdout;
      }
      throw error;
    }
  }
}

// Start the server
const app = new OpenClawGlassesApp();
app.start().catch(console.error);