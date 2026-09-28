# TetriNET — online

A new web port of TetriNET, the multiplayer game created by St0rmCat in 1997, with a small game server.
The original game, its design and its name belong to its creator; this port is independent and not endorsed by St0rmCat.

- Open the page and type your **Callsign** (nickname). **Open Games** lists the public games:
  how full each is, whether it's waiting or already playing (join to watch, then play the next
  round), and who hosts it. Press **Join** on one.
- **+ New Game** starts your own: give it a name and choose **Public** (listed for everyone) or
  **Private** (needs a password you choose, and isn't listed).
- **Got a code?** Type the 6-character game code. A password box appears only if that game is
  private. Invite links (**Copy Invite Link**, or tap the code in the room) open straight to the game.
- **Practice against bots** plays offline against computer opponents.
- In a room, the top strip shows every player (♛ is the moderator, your own tag changes your team;
  the moderator can remove players with ✕). There is one chat, the **Messages** box, used the
  same way while waiting and during games; while waiting, you can just start typing.
- Up to 6 players per game. The first player in is the moderator (marked `*`): they set the
  rules and press **Start New Game**. If they leave, the next player takes over.
- Empty games are removed after 2 minutes.
- The page opens on the lobby; the Playing Fields open by themselves when you join a room or
  press **Practice against bots**, and stay open while you're in a room.
- **Music** (Settings → Sound and Theme → Music Track): the original "The Dance of the Spheres", or
  one of three originals made for this port: **Midnight Circuit** (indie-disco / French house),
  **Chrome Nights** (French electro / night-drive synthwave) and **Evergreen Signal** (psychedelic
  jam-rock over techno). Your choice is remembered. The new songs' instruments are synthesized once
  when the song is chosen (a second or two) and then replayed, so they're light on the CPU.
  The `.mid` files are in the `music` folder.
- **Display** (top right): **Modern** is a neon grid look; **Legacy** is the original look
  with the original graphics. It's a per-player choice and doesn't change the game.
- The side column shows the next special block (what it does, attack or defense, who it would
  hit best, which key uses it), the attacks/defenses log and the in-game messages (press **T** to talk).
- Opponents' fields are drawn 25% larger than in the original, and the playing fields scale to
  fill the browser window.
- The top window collapses automatically once you start or join a game, and the Settings window
  starts collapsed; **Show** opens either one.
- Settings that aren't self-explanatory have a **?** button that explains them.
- **Phones and tablets:** when a game starts, the fields fill the screen with touch controls.
  - **Phones play sideways.** Holding the phone upright during a game shows a "Turn your phone
    sideways" screen (offline games pause until you do; online games keep going for everyone
    else). Where the browser allows it (Android Chrome), the game also switches to full screen and
    turns to landscape by itself; **⛶** toggles full screen. Menus work either way up. Tablets
    can play in either orientation; computers are unaffected.
  - **Gestures on your own field:** drag sideways to move, tap to rotate (right half clockwise,
    left half counter-clockwise), drag down and hold to drop faster, flick down to drop.
  - **Buttons** at the sides do the same: ◀ ▶ move, ▼ (hold) drops faster, ⟲ ⟳ rotate, DROP.
  - **Special blocks:** drag your first special block (under your field) onto a player's field to
    use it on them — the field lights up; drop it on your own field to use it on yourself. You can
    also tap a player's button or field. D discards it; tapping the block or its icon explains it.
  - **Menu** returns to the lobby and chat; **Back to Game** returns to the game. Opponents are
    drawn at the original size there. Misc. Settings → Controls can force touch or keyboard controls.
  - No ghost piece, as in the original.
- **Install as an app:** on Android (Chrome) an **⤓ Install App** button appears at the top of the
  page; on iPhone/iPad it explains Safari's Share → **Add to Home Screen**. Opened from its
  home-screen icon, TetriNET runs full screen like an app: no browser bars, no "exit full screen"
  notice, and it turns sideways by itself when a game starts (menus can be upright). Without
  internet it still opens, for offline games against bots.
- In the browser, full screen stays on through the menu and between games, so the phone's
  "to exit full screen…" notice shows only once. **⛶** turns full screen off.

## Files

| File | What it is |
|---|---|
| `server.js` | Serves the page and runs the game rooms over a WebSocket (same address). |
| `public/index.html` | The whole game: engine, graphics, sounds, music, lobby. |
| `public/manifest.webmanifest`, `public/sw.js`, `public/*.png` | What phones need to install the game as an app: name, icons, and offline start-up. |
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

1. On GitHub, open your repository and choose **Add file → Upload files**.
2. Drag in the new files. Files with the same name are replaced. For this update:
   `server.js`, `README.md`, and in the `public` folder: `index.html`, `manifest.webmanifest`,
   `sw.js`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`,
   `favicon-64.png`. If in doubt, upload everything again except `node_modules`.
3. **Commit changes**. Render notices the commit and redeploys by itself (watch the
   **Events** tab on your service; it takes 1–3 minutes). If auto-deploy is off, press
   **Manual Deploy → Deploy latest commit**.
4. Reload the game page. Games that were running are ended by the redeploy.
