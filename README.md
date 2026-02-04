# OpenClaw Glasses

Voice-controlled AI assistant for Even G1 smart glasses using [OpenClaw](https://openclaw.ai) and [MentraOS](https://mentra.ai).

## Features

- 🎤 **Wake word activation** - Say "Hey Little Bot" to activate
- 🦀 **OpenClaw integration** - Full AI assistant capabilities
- 👓 **Optimized for glasses** - Short, readable responses
- 😴 **Auto-sleep** - Saves battery when inactive

## Prerequisites

- Node.js 18+
- [OpenClaw](https://openclaw.ai) installed and running (`openclaw gateway`)
- [MentraOS](https://console.mentra.ai) account and API key
- Even G1 smart glasses paired via MentraOS app

## Setup

1. Clone and install:
```bash
git clone https://github.com/YOUR_USERNAME/openclaw-glasses.git
cd openclaw-glasses
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Edit `.env` with your credentials:
```
PORT=3000
PACKAGE_NAME=your.package.name
MENTRAOS_API_KEY=your_mentra_api_key
OPENCLAW_URL=http://localhost:8780
```

4. Start OpenClaw gateway:
```bash
openclaw gateway
```

5. Run the app:
```bash
npm run dev
```

6. Open MentraOS console, connect your glasses, and select this app.

## Voice Commands

| Command | Action |
|---------|--------|
| "Hey Little Bot" | 👂 Wake up and listen |
| [your question] | 🦀 Send to OpenClaw |
| "Go to sleep" / "Bye" | 😴 Sleep mode |

## Running as a Service (macOS)

Create a LaunchAgent for auto-start:

```bash
# Create plist at ~/Library/LaunchAgents/ai.openclaw.glasses.plist
launchctl load ~/Library/LaunchAgents/ai.openclaw.glasses.plist
launchctl start ai.openclaw.glasses
```

## License

MIT
