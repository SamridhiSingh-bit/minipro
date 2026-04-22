# DebateX 🎙️⚔️

Real-time AI-judged debate platform. Two people debate live, an AI Judge evaluates every argument, generates the topic, and delivers a final verdict.

## Features
- Real-time two-player debates via Socket.IO
- AI Judge (Claude) generates debate topics
- AI evaluates arguments as the debate progresses
- Final AI verdict with winner declaration and scores
- Room codes for easy sharing
- Spectator mode
- Login/Register system

## Local Development

```bash
npm install
ANTHROPIC_API_KEY=your_key_here node server.js
```

Open http://localhost:3000

## Deploy to Render

### Method 1: render.yaml (Blueprint)
1. Push this repo to GitHub
2. Go to https://render.com → New → Blueprint
3. Connect your GitHub repo
4. Render will auto-detect render.yaml
5. Add your `ANTHROPIC_API_KEY` in the Environment Variables section
6. Deploy!

### Method 2: Manual
1. Push to GitHub
2. Go to Render → New → Web Service
3. Connect repo
4. Settings:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Node Version**: 18+
5. Add Environment Variables:
   - `ANTHROPIC_API_KEY` = your Anthropic API key
   - `SESSION_SECRET` = any random string (or auto-generate)
6. Deploy

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `SESSION_SECRET` | Yes | Secret for session cookies |
| `PORT` | Auto | Set by Render automatically |

## How to Use

1. Open the deployed URL
2. Register/Login
3. Create a room — share the 8-character room code
4. Your opponent opens the same URL, logs in, clicks "Join by Code"
5. Both join → AI Judge generates the topic → Debate begins!
6. Either debater can end the debate to get the final verdict
