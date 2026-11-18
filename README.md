# NetSpeed Guardian

A fully functional, responsive, production-ready web application that continuously monitors your Wi-Fi internet speed and automatically sends WhatsApp alerts to your provider when speed drops below a user-defined threshold.

## Overview

**NetSpeed Guardian** consists of two parts:

1. **React Dashboard** (`frontend/`) — Modern, dark-themed UI for configuring monitoring parameters and viewing live speed data, history, and alert history.
2. **Node.js Background Agent** (`agent/`) — Always-on background program that runs speed tests, stores data in Firestore, and sends WhatsApp alerts via the Meta Graph API.

The dashboard is for configuration and visibility. The **agent runs continuously in the background** (via systemd, Docker, or `node src/index.js start`) even after the browser closes.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React + Vite Dashboard                   │
│  (frontend/  —  port 5173 default, serves on Vercel)        │
│         ↑         ↑         ↑           ↑           ↑       │
│  WebSocket ↔ HTTP API ↔ Meta WhatsApp Business Cloud API     │
│         ↑         ↑         ↑           ↑           ↑       │
│  Firebase Firestore (config, speed test history, alerts)   │
└─────────────────────────────────────────────────────────────┘

          └─────────────────────────────────────┘
                Always-On Node.js Agent
                (agent/  —  port 8787 default)
                ↱ continuous loop: speed test every 60s
                     ↱ stores results in Firestore
                     ↱ sends WhatsApp alerts when ⬇️ below threshold
                     ↱ pushes live updates via WebSocket
```

---

## Quick Start (Local Development)

### 1. Prerequisites

- Node.js >= 18
- Firebase project with Firestore enabled
- Meta WhatsApp Business Cloud API credentials
- Google Chrome/Firefox

### 2. Install & Run the Agent

```bash
cd /home/kali/myproject/netspeed-guardian/agent
source venv/bin/activate      # or: . venv/bin/activate
npm install                   # installs: ws, firebase-admin, node-fetch, dotenv
cp .env.example .env          # fill in your WhatsApp/Firebase secrets
node src/index.js start       # starts agent on http://127.0.0.1:8787
```

The agent will:
- Listen on `http://127.0.0.1:8787` (configurable via `AGENT_PORT`, `AGENT_HOST`)
- Expose HTTP endpoints: `/health`, `/config`, `/test`, `/alert`, `/start-monitoring`, `/stop-monitoring`
- Push live speed data via WebSocket at `ws://127.0.0.1:8787/ws`
- Run speed tests every 60s (configurable via `INTERVAL_SECONDS`)
- Send WhatsApp alerts when download speed falls below the threshold (configurable via `ALERT_THRESHOLD_MBS`)

### 3. Start the React Dashboard

```bash
cd /home/kali/myproject/netspeed-guardian/frontend
npm install
npm run dev                   # runs Vite on http://localhost:5173
```

The dashboard will:
- Connect to the agent WebSocket and HTTP API
- Show live download/upload speeds and latency
- Display status indicators: Green (normal), Yellow (approaching threshold), Red (below threshold), Grey (inactive)
- Allow configuration of WhatsApp numbers, package speed, alert threshold, and message
- Start/stop monitoring
- View speed test history and WhatsApp alert history

---

## Production Deployment

### Option A: Vercel (Frontend) + Local Agent or Cloud Run

1. **Push to GitHub** — push the `netspeed-guardian` directory (or the full repo).
2. **Vercel Setup**:
   - Create a new project → import from GitHub.
   - Framework: Vite.
   - Build command: `npm run build`.
   - Output directory: `dist`.
   - Add environment variables in the Vercel dashboard:
     - `VITE_AGENT_API_BASE` — e.g. `https://your-agent-url.railway.app/api` (if agent is hosted elsewhere).
     - Any Firebase config vars if you want Firestore directly from the frontend (not recommended for WhatsApp secrets).
3. **Deploy** — Vercel will build and deploy. Visits to your Vercel URL will show the dashboard.

### Option B: Full Stack — Agent + Firestore + WhatsApp (Recommended)

The agent must run somewhere with internet access and the WhatsApp API credentials. Options:

- **Systemd on a VPS** (the `deploy/systemd/netspeed-guardian.service` file is ready).
- **Docker** — a Dockerfile can be added.
- **Firebase Cloud Functions** — the agent cannot run inside Cloud Functions because they can't measure your home Wi-Fi speed (functions run on cloud infrastructure). The agent must run on a device on your home network.

### Firebase Configuration

1. Create a Firebase project at https://console.firebase.google.com/.
2. Enable **Authentication** (email/password or phone).
3. Enable **Firestore Database** (start in test mode, then lock down with rules — see below).
4. Create a **Service Account key**: Project Settings → Service accounts → Generate new private key. Save the JSON file.
5. Place the service account JSON somewhere accessible to the agent and set `GOOGLE_APPLICATION_CREDENTIALS` env var (or set `config.firebase.credentialPath` in the agent's `.env`).

**Firestore Secure Rules** (update in Firebase console):

```javascript
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only read/write their own data
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    match /users/{userId}/settings {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      allow create: if request.auth != null;
    }

    match /users/{userId}/speedTests {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      allow create: if request.auth != null;
    }

    match /users/{userId}/alerts {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      allow create: if request.auth != null;
    }
  }
}
```

---

## Environment Variables

Create `.env` in `agent/` with these variables (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `AGENT_PORT` | `8787` | Agent HTTP/WS port |
| `AGENT_HOST` | `127.0.0.1` | Agent bind address |
| `WHATSAPP_ACCESS_TOKEN` | `` | Meta Graph API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | `` | Your WhatsApp Business phone number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | `` | Your WhatsApp Business account ID |
| `WHATSAPP_API_VERSION` | `v21.0` | WhatsApp Cloud API version |
| `GOOGLE_APPLICATION_CREDENTIALS` | `` | Path to Firebase service account JSON |
| `FIREBASE_PROJECT_ID` | `` | Your Firebase project ID |
| `SPEEDTEST_DOWNLOAD_URL` | `https://speedtest.selectel.com/10MB.bin` | Download URL for speed test |
| `SPEEDTEST_UPLOAD_URL` | `https://speedtest.selectel.com/upload` | Upload URL for speed test |
| `SPEEDTEST_SAMPLE_BYTES` | `8388608` (8 MB) | Sample size in bytes |
| `SPEEDTEST_TIMEOUT_MS` | `30000` | Speed test timeout in ms |
| `INTERVAL_SECONDS` | `60` | Monitoring interval |
| `ALERT_THRESHOLD_MBS` | `5` | Alert when speed drops below (MB/s) |
| `COOLDOWN_SECONDS` | `300` | Cooldown between alerts (5 min) |

**.env.example** (already in `agent/`):
```env
# WhatsApp Business Cloud API
WHATSAPP_ACCESS_TOKEN=your_token_here
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id
WHATSAPP_API_VERSION=v21.0

# Firebase
GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
FIREBASE_PROJECT_ID=your-project-id

# Speed test
SPEEDTEST_DOWNLOAD_URL=https://speedtest.selectel.com/10MB.bin
SPEEDTEST_UPLOAD_URL=https://speedtest.selectel.com/upload
SPEEDTEST_SAMPLE_BYTES=8388608
SPEEDTEST_TIMEOUT_MS=30000

# Monitoring
INTERVAL_SECONDS=60
ALERT_THRESHOLD_MBS=5
COOLDOWN_SECONDS=300
```

---

## WhatsApp Business Cloud API Setup

1. **Apply for WhatsApp Business Cloud API** at https://developers.facebook.com/docs/whatsapp/cloud-api/.
2. **Verify your phone number** and obtain:
   - Access Token
   - Phone Number ID
   - Business Account ID
3. **Add the recipient** (`+8801581955035` by default, or your number) as a **WhatsApp Business recipient** — this must be done via the Facebook developer console; the API will reject messages to unregistered numbers.
4. **Configure message templates** if you want to use approved templates; otherwise, the free-form text approach in this project works for business-account-verified numbers.

**Important**: Never commit real tokens to source control. The `.env` file is listed in `.gitignore`. Use Vercel/GitHub Actions secrets or environment variable injection at deployment time.

---

## GitHub + Vercel + Firebase Deployment Checklist

```
[ ] Push code to a GitHub repository
[ ] Create a Vercel project, connect the repo
[ ] Set Vercel env vars (VITE_AGENT_API_BASE if needed)
[ ] Deploy frontend to Vercel
[ ] Set up Firebase project (Auth + Firestore)
[ ] Download service account key, add to agent .env
[ ] Set up WhatsApp Business Cloud API credentials in agent .env
[ ] Install agent on a always-on device (systemd, Docker, or a home server)
[ ] Test: configure numbers, start monitoring, verify speed drops trigger WhatsApp alert
[ ] Customize Firestore rules for your use case
[ ] Add custom domain / SSL if desired
```

---

## License

This project is for educational and personal use. WhatsApp Business Cloud API terms apply. Do not share API credentials publicly.

---

## Need Help?

- Check the `agent/` logs: `node src/index.js start` then `Ctrl+C` to stop, or view `agent/logs.txt` if redirected.
- Dashboard shows real-time state via WebSocket.
- Open issues on the GitHub repository.