# Mitra Chat

Mitra Chat is an original, locally runnable real-time messaging app. It uses React + Vite in the frontend and Node.js + Express + Socket.IO in the backend. SQLite stores the data in `data/mitra-chat.db`, so no paid service or API key is needed.

## Quick start for beginners

### 1. Install Node.js

Install the current LTS version from [nodejs.org](https://nodejs.org/). Then open this project folder in VS Code.

### 2. Install packages

Open the VS Code terminal and run:

```powershell
npm install
```

### 3. Start the app

Run both the browser app and backend with one command:

```powershell
npm run dev
```

Open `http://localhost:5173`.

The backend runs at `http://localhost:3001`. A quick check is:

```powershell
Invoke-RestMethod http://localhost:3001/api/health
```

### 4. Test multiple users

1. Open one normal browser window and register User A.
2. Open a private/incognito window and register User B.
3. In User A, search for User B's username and start a conversation.
4. Send a message. User B receives it without refreshing.
5. Type in the second window to see the typing indicator in the first window.

Hindi mein: pehle `npm install`, phir `npm run dev`. Do alag browser sessions mein do accounts banao. Isse real database aur Socket.IO connection test hoga, fake demo chat nahi.

### Test from a phone or another network

Start the public tunnel:

```powershell
npm run public
```

Localtunnel prints an HTTPS address such as `https://some-name.loca.lt`. Open that exact address on your phone and share it with the other tester. Keep the terminal open: it is running the frontend, backend, and tunnel together. Both users will use the same local SQLite database and Socket.IO server.

The frontend uses same-origin `/api` and `/socket.io` paths. Vite proxies those paths to the backend, which is why the public URL works on a different device without exposing `localhost` URLs to the phone.

This tunnel is for development/testing. It is not a production deployment, and the local computer must remain online. Never expose real secrets or sensitive production data through a development tunnel.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite and the API together |
| `npm run dev:client` | Start only the React frontend |
| `npm run dev:server` | Start only the API and Socket.IO server |
| `npm run build` | Create a production frontend build |
| `npm run lint` | Run Oxlint |

## Architecture

```text
src/
  App.jsx       React screens, auth flow, chat workspace, realtime client
  App.css       Mitra Chat visual system and responsive layout
  index.css     Global typography and reset
backend/
  auth.js       Registration, login, JWT middleware, password hashing
  chat.js       User search, direct conversations, messages, profile API
  db.js         SQLite database, tables, indexes, relationships
server.js       Express app, Socket.IO events, presence and typing
```

Tables currently included: `users`, `conversations`, `conversation_members`, `messages`, and `blocked_users`. Passwords are bcrypt-hashed, protected API routes require a JWT, message access checks conversation membership, SQLite uses WAL mode, message history is limited to 100 records per request, and messages retain `message_type`, `read_at`, and attachment metadata.

Attachments are validated on both sides, limited to 10 MB, and stored under `UPLOAD_DIR` (default `uploads`). For real production deployment, point `UPLOAD_DIR` at persistent storage or replace the local upload adapter with an authenticated object-storage adapter. Render's free filesystem is ephemeral, so local uploads can disappear after restart. WebRTC uses a public STUN server for direct connections; a TURN service is still required for users behind restrictive NAT/firewalls and must be configured through environment variables before production use.

## Deploy free on Render

This repository is prepared as a single Render web service. Express serves the Vite `dist` directory, REST and Socket.IO share one HTTPS origin, and the server listens on Render's injected `PORT`.

### Before you deploy: GitHub

1. Create a GitHub account at [github.com](https://github.com/) if you do not already have one.
2. Create a new empty repository named `mitra-chat`. Do not add a second README or `.gitignore`.
3. In this project folder, open the VS Code terminal and run:

```powershell
git init
git add .
git commit -m "Prepare Mitra Chat for Render"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/mitra-chat.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username. GitHub may open a browser sign-in flow. If Git asks for a password, use GitHub's recommended browser sign-in or a personal access token, not your normal GitHub password.

### Render deployment

1. Go to [render.com](https://render.com/) and sign in with GitHub.
2. Choose **New +** and **Blueprint**.
3. Select the `mitra-chat` repository and click **Apply**. Render reads the included `render.yaml`.
4. Confirm the service is on the **Free** plan. The blueprint uses `npm install && npm run build` and `npm start`.
5. In the service's Environment section, confirm `JWT_SECRET` exists. Render generates it from the blueprint; do not paste a real secret into source code.
6. Wait for the deploy to finish, then open the `https://mitra-chat-....onrender.com` URL shown by Render.

No paid API, card-backed integration, or paid add-on is required by this project. Render may still apply its own account verification or platform policy, and its free web services can sleep after inactivity. A sleeping service wakes on the next request, so the first load may take a little longer.

### Important database limitation

The current SQLite file is stored in `data/mitra-chat.db`. Render's free service filesystem is ephemeral: a restart, redeploy, or instance replacement can erase that file. This is acceptable for free multi-device testing, but it is not durable production storage. Durable hosted persistence requires a database service; do not add one without choosing a genuinely free option and checking its current limits first.

### Render troubleshooting

- **Application failed to start:** check the deploy logs for the `npm install` or `better-sqlite3` build step.
- **Blank page or 404 on refresh:** confirm the latest commit contains `server.js`'s `dist` static serving and SPA fallback.
- **Socket connection errors:** use the Render HTTPS URL, not the local Vite URL. Socket.IO is served from the same origin automatically.
- **Old data disappeared:** this is the expected free-filesystem limitation described above.

## Environment variables

For local development, defaults are already provided. For a deployment, create a `.env` file and set at least:

```env
PORT=3001
CLIENT_URL=http://localhost:5173
JWT_SECRET=replace-with-a-long-random-secret
ALLOW_EXTERNAL=true
UPLOAD_DIR=uploads
```

Never commit real secrets. No paid APIs, paid storage, SMS provider, email provider, or billing-dependent feature is included.

## Current product slice

The runnable foundation includes registration, login, logout, password hashing, JWT sessions, unique usernames, profile data, user search, direct conversations, persisted messages, Socket.IO realtime delivery, typing indicators, online presence, last-seen updates, delivered/read status events, unread counts, message timestamps, responsive mobile layout, notification controls placeholder, and light/dark appearance.

The current realtime slice also includes server-authoritative delivered/read receipts, typing and presence events, validated multipart attachments, WebRTC audio/video signaling, incoming-call controls, microphone/camera mute controls, and cleanup on call end. Test calls on HTTPS with two real devices or browser profiles; local media permissions and restrictive NATs can prevent a direct peer connection. Group membership, message actions, browser notifications, rate limiting, forgot-password tokens, and moderation/report workflows remain separate product modules.
