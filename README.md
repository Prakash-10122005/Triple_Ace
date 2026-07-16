# ♠ Triple Ace — Multiplayer Card Game

A real-time multiplayer card game built with Node.js + Socket.io.
Dark luxury premium style. 2–10 players. 6-digit room codes.

---

## 🚀 Quick Setup (5 minutes)

### Step 1 — Install Node.js
Download from: https://nodejs.org (choose LTS version)

### Step 2 — Extract & Install
```bash
cd tripleace
npm install
```

### Step 3 — Start the Server
```bash
npm start
```
You'll see:
```
🃏 Triple Ace server running on http://localhost:3000
```

### Step 4 — Play!
- Open http://localhost:3000 in your browser
- Click **Create Room** → share the 6-digit code
- Friends open the same URL and click **Join Room**

---

## 🌐 Play Over the Internet (Free Options)

### Option A — Railway.app (Recommended, Free)
1. Go to https://railway.app and sign up
2. Click "New Project" → "Deploy from GitHub"
3. Upload your tripleace folder
4. Railway gives you a URL like: https://tripleace-xxx.railway.app
5. Share that URL with friends — they open it and join!

### Option B — Render.com (Free)
1. Go to https://render.com and sign up
2. New → Web Service → connect your code
3. Build command: `npm install`
4. Start command: `npm start`
5. Free URL provided automatically

### Option C — Local Network (Same WiFi)
1. Find your local IP: run `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
2. Look for something like `192.168.1.xxx`
3. Start server: `npm start`
4. Friends on same WiFi open: `http://192.168.1.xxx:3000`

---

## 🎮 How to Play

1. **Host** opens the game → enters name → Create Room
2. **Friends** open the same URL → enter name → enter 6-digit code → Join Room
3. Host sees all players in waiting room → click **Start Game**
4. **Reveal screen** — each player sees everyone's highest card value (no suit)
5. Host clicks **Start Round 1**
6. **Play!**
   - It's your turn when your avatar glows gold
   - **Double-click** a card to play it
   - If you have no lead-suit cards → choose a suit group to throw as **Vettu**
   - Vettu ends the round immediately — all cards go to the highest-card player
   - First player to empty their hand wins!

---

## 📁 File Structure

```
tripleace/
├── server.js          ← Node.js + Socket.io game server
├── package.json       ← Dependencies
├── public/
│   └── index.html     ← Game client (HTML/CSS/JS)
└── README.md          ← This file
```

---

## ⚙️ Configuration

Change port in server.js:
```js
const PORT = process.env.PORT || 3000;
```
Or set environment variable: `PORT=8080 npm start`

---

## 🃏 Game Rules Summary

- 3 cards dealt to each player
- Draw 3 from pile when hand is empty
- Must follow lead suit if you have it
- No lead suit → throw ALL cards of one suit as **Vettu** (punishment!)
- Vettu ends round immediately — all table cards go to highest-lead-card player's hand
- Clean round → all cards go to dead pile forever
- First player with empty hand (after draw pile is empty) wins!
