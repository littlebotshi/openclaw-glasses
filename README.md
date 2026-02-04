# OpenClaw Glasses

Voice-controlled AI assistant for Even G1 smart glasses using [OpenClaw](https://openclaw.ai) and [MentraOS](https://mentra.ai).

Created by [@shibenshi](https://x.com/shibenshi)

## Features

- 🎤 **Wake word activation** - Say "Hey Claw" to start
- 🦀 **OpenClaw integration** - Full AI assistant capabilities  
- 👓 **Optimized for glasses** - Short, readable responses
- 😴 **Auto-sleep** - Saves battery when inactive

## Prerequisites

- Node.js 18+
- [OpenClaw](https://openclaw.ai) installed and running
- [MentraOS](https://console.mentra.ai) account and API key
- Even G1 smart glasses paired via MentraOS app

## Setup

1. **Clone and install:**
```bash
git clone https://github.com/YOUR_USERNAME/openclaw-glasses.git
cd openclaw-glasses
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your MentraOS API key
```

3. **Start ngrok tunnel:**
```bash
ngrok http 3000
```
Copy the HTTPS URL (e.g., `https://abc123.ngrok-free.app`)

4. **Register in MentraOS Console:**
   - Go to [console.mentra.ai](https://console.mentra.ai)
   - Add your app with the ngrok URL as the endpoint
   - Copy your API key to `.env`

5. **Start OpenClaw gateway:**
```bash
openclaw gateway
```

6. **Run the app:**
```bash
npm run dev
```

7. **Connect glasses:**
   - Open [MentraOS Console](https://console.mentra.ai)
   - Pair your Even G1 glasses
   - Select this app from the app list

## Usage

Once connected, you'll see "🦀 Say 'Hey Claw' to activate" on your glasses.

### Voice Commands

| Say this | What happens |
|----------|--------------|
| **"Hey Claw"** | 👂 Wakes up and starts listening |
| **[your question]** | 🦀 Sends to OpenClaw, shows response |
| **"Go to sleep"** or **"Bye"** | 😴 Stops listening (saves battery) |

### Example Conversation

1. **You:** "Hey Claw"  
   **Glasses:** 👂 Listening! What can I help with?

2. **You:** "What's the weather like?"  
   **Glasses:** Currently 72°F, sunny with light breeze.

3. **You:** "Go to sleep"  
   **Glasses:** 😴 Sleeping... Say 'Hey Claw' to wake

### Tips

- Keep questions **short and specific** for best results
- The display shows **max 150 characters** - responses are auto-truncated
- **Auto-sleep** kicks in after 30 seconds of inactivity
- Customize wake words in `src/index.ts` (line 39)

## Customization

### Change Wake Word
Edit `src/index.ts` line 39:
```typescript
const wakeWords = ['hey claw', 'hey openclaw', 'ok claw'];
// Add your own: ['hey jarvis', 'computer', ...]
```

### Adjust Response Length
Edit `src/index.ts` line 93:
```typescript
const displayText = response.length > 150  // Change limit here
```

## Running as a Service (macOS)

Create `~/Library/LaunchAgents/ai.openclaw.glasses.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>ai.openclaw.glasses</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/openclaw-glasses/dist/index.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Then:
```bash
launchctl load ~/Library/LaunchAgents/ai.openclaw.glasses.plist
```

## License

MIT
