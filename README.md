# TetriNET v1.13 — online

A browser port of St0rmCat's TetriNET v1.13 (1997) with a small game server.

- Open the page, type a nickname and **Create Game**: choose **Public** (listed on the landing
  page for anyone to join) or **Private** (needs a password you choose).
- Others join from the **Public Games** list, with the 6-character **game code**, or from an
  invite link (**Copy Invite Link** inside a game). Private games also ask for the password.
- Up to 6 players per game. The first player in is the moderator (marked `*`): they set the
  rules and press **Start New Game**. If they leave, the next player takes over.
- Empty games are removed after 2 minutes.

## Files

| File | What it is |
|---|---|
| `server.js` | Serves the page and runs the game rooms over a WebSocket (same address). |
| `public/index.html` | The whole game: engine, graphics, sounds, music, lobby. |
| `package.json` | Node.js project file (one dependency: `ws`). |
| `render.yaml` | Optional one-click setup for Render. |

## Run it on your own computer

Requires Node.js 18 or newer.

```
npm install
npm start
```

Open http://localhost:3000 in two browser windows to try it with yourself.
Friends on the same Wi-Fi can join at `http://YOUR-PC-IP:3000`.

## Put it online for free (Render)

1. Create a GitHub account if you don't have one, then a **new repository** (e.g. `tetrinet-online`).
2. On the repository page choose **Add file → Upload files**, drag in `server.js`, `package.json`,
   `package-lock.json`, `render.yaml`, `README.md`, `.gitignore` and the `public` folder, then **Commit changes**.
   (Do not upload `node_modules`.)
3. Sign up at https://render.com with your GitHub account.
4. **New → Web Service**, pick the repository, and set:
   - Language / Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
5. **Deploy**. When it says *Live*, your game is at `https://<name>.onrender.com`. Share that link.

### Free-tier behaviour

- After 15 minutes with nobody connected the server goes to sleep. The next visitor waits about
  a minute while it wakes up; after that it is instant. An open game keeps it awake.
- Games and their win lists live in memory: they disappear when the server sleeps or restarts.
- Passwords are stored only as salted hashes, and only while the game exists.
- 750 free hours a month covers one server running all month.

## Updating

Edit files on GitHub (or upload new versions). Render redeploys automatically on every commit.
