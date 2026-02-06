# OpenClaw Glasses App

Voice-controlled AI assistant for Even Realities G1 smart glasses, powered by [OpenClaw](https://openclaw.ai).

## Features

- 🎤 **Voice activation** - Say "Hello" to wake, "Goodbye" to sleep
- ⚡ **Fast responses** - Uses WebSocket gateway (~3s) with CLI fallback (~8s)
- 🔄 **Auto-reconnect** - Resilient connection with exponential backoff
- 💤 **Battery-efficient** - Only processes when activated

## Prerequisites

1. **MentraOS Developer Account** - Get API key from [mentra.ai](https://mentra.ai)
2. **OpenClaw CLI** - Install and authenticate: `npm i -g openclaw && openclaw auth`
3. **Even Realities G1 glasses** - Paired with MentraOS app

## Setup

1. Clone and install:
   ```bash
   git clone https://github.com/littlehome-eugene/openclaw-glasses.git
   cd openclaw-glasses
   npm install
   ```

2. Configure `.env`:
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. Run:
   ```bash
   npm start
   ```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PACKAGE_NAME` | ✅ | Your MentraOS app package name |
| `MENTRAOS_API_KEY` | ✅ | Your MentraOS API key |
| `PORT` | ❌ | Server port (default: 3000) |
| `GLASSES_PROMPT` | ❌ | Custom system prompt |
| `COMMAND_TIMEOUT_MS` | ❌ | AI response timeout (default: 30000) |
| `AUTO_SLEEP_MS` | ❌ | Auto-sleep after inactivity (default: 30000) |

## Usage

1. Start the app: `npm start`
2. Connect glasses to MentraOS app
3. Say **"Hello"** to activate
4. Ask anything!
5. Say **"Goodbye"** to deactivate

## Architecture

```
src/
├── index.ts              # Entry point, global error handlers
├── config.ts             # Environment configuration
├── types.ts              # TypeScript types
├── state-machine.ts      # Session state management
└── handlers/
    ├── gateway-client.ts # WebSocket gateway client
    ├── openclaw.ts       # AI query (gateway + CLI fallback)
    └── transcription.ts  # Voice command handling
```

## Gateway vs CLI

The app tries the WebSocket gateway first for faster responses:

| Method | Response Time |
|--------|---------------|
| Gateway (WebSocket) | ~2-3s ✅ |
| CLI (fallback) | ~7-8s |

The gateway requires OpenClaw authentication (`openclaw auth`).

## Running as a Service (macOS)

Create a LaunchAgent for persistent running:

```bash
# Create plist
cat > ~/Library/LaunchAgents/ai.openclaw.glasses.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.openclaw.glasses</string>
    <key>WorkingDirectory</key>
    <string>/path/to/openclaw-glasses</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/npm</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/glasses.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/glasses.err.log</string>
</dict>
</plist>
EOF

# Load service
launchctl load ~/Library/LaunchAgents/ai.openclaw.glasses.plist
```

## License

MIT
