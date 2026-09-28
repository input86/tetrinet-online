'use strict';
/*
 * TetriNET online server (web port).
 *
 * Serves the game page from ./public and hosts any number of game rooms
 * (up to 6 players each) over a WebSocket on the same address.
 * Rooms are public (listed on the landing page) or private (password needed).
 *
 * Like the original TetriNET server, a room does not simulate anyone's field:
 * each client runs its own game and the room relays field updates ("f"),
 * special blocks ("sb"), levels ("lvl") and losses, decides the winner
 * and keeps the room's win list.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MAX_PLAYERS = 6;
const MAX_ROOMS = 100;
const EMPTY_ROOM_TTL = 2 * 60 * 1000;   // an empty room survives 2 minutes (page reloads, invite links)
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain' };

/* ---------- static files ---------- */
const server = http.createServer((req, res) => {
  let u;
  try { u = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (u === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (u === '/') u = '/index.html';
  const file = path.normalize(path.join(PUB, u));
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

/* ---------- helpers ---------- */
const FIELD_RE = /^[0-5acnrsbgqo]{264}$/;
const SP_RE = /^([acnrsbgqo]|cs[1-4])$/;
const ROOM_ID_RE = /^[A-Z0-9]{6}$/;
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const send = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };

function newRoomId() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I, easy to read aloud
  for (;;) {
    let id = '';
    const b = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) id += A[b[i] % A.length];
    if (!rooms.has(id)) return id;
  }
}
function hashPassword(pw, salt) { return crypto.scryptSync(pw, salt, 32); }
function checkPassword(room, pw) {
  if (!room.pwHash) return true;
  const h = hashPassword(String(pw || ''), room.pwSalt);
  return crypto.timingSafeEqual(h, room.pwHash);
}

/* ---------- rooms ---------- */
const rooms = new Map();        // id -> room
const browsers = new Set();     // sockets on the landing page (not in a room)

function makeRoom(name, isPrivate, password) {
  const room = {
    id: newRoomId(), name, private: isPrivate, pwSalt: null, pwHash: null,
    slots: new Array(MAX_PLAYERS + 1).fill(null), joinOrder: 0, winlist: [],
    emptySince: Date.now(), created: Date.now(),
    game: { running: false, paused: false, cfg: null, roster: [], dead: {}, fields: {}, levels: {}, lossOrder: [], seconds: 0, timer: null }
  };
  if (isPrivate) { room.pwSalt = crypto.randomBytes(16); room.pwHash = hashPassword(password, room.pwSalt); }
  rooms.set(room.id, room);
  return room;
}
function count(room) { return room.slots.filter(Boolean).length; }
function moderator(room) {
  let best = 0, order = Infinity;
  for (let s = 1; s <= MAX_PLAYERS; s++) if (room.slots[s] && room.slots[s].order < order) { order = room.slots[s].order; best = s; }
  return best;
}
function broadcast(room, obj, exceptSlot) {
  const msg = JSON.stringify(obj);
  for (let s = 1; s <= MAX_PLAYERS; s++) {
    const sl = room.slots[s];
    if (sl && s !== exceptSlot && sl.ws.readyState === 1) sl.ws.send(msg);
  }
}
function sys(room, text) { broadcast(room, { t: 'pline', from: 0, text }); }
function playersMsg(room) {
  const list = [];
  for (let s = 1; s <= MAX_PLAYERS; s++) if (room.slots[s]) list.push({ slot: s, name: room.slots[s].name, team: room.slots[s].team });
  return { t: 'players', players: list, mod: moderator(room) };
}
function roomSummary(room) {
  const mod = moderator(room);
  return { id: room.id, name: room.name, private: room.private, players: count(room), max: MAX_PLAYERS,
           running: room.game.running, host: mod ? room.slots[mod].name : '' };
}
function publicList() {
  const list = [];
  for (const r of rooms.values()) if (!r.private && count(r) > 0) list.push(roomSummary(r));
  list.sort((a, b) => (a.running - b.running) || (b.players - a.players) || a.name.localeCompare(b.name));
  return list;
}
let listTimer = null;
function listChanged() {             // push the public list to everyone on the landing page (debounced)
  if (listTimer) return;
  listTimer = setTimeout(() => {
    listTimer = null;
    const msg = JSON.stringify({ t: 'rooms', rooms: publicList() });
    for (const ws of browsers) if (ws.readyState === 1) ws.send(msg);
  }, 250);
}

/* ---------- game flow (per room) ---------- */
function inGame(room, slot) { return room.game.running && room.game.roster.some(r => r.slot === slot); }
function rosterOf(room, slot) { return room.game.roster.find(r => r.slot === slot); }
function sameTeam(room, a, b) {
  const ra = rosterOf(room, a), rb = rosterOf(room, b);
  return !!(ra && rb && ra.team && rb.team && ra.team.toUpperCase() === rb.team.toUpperCase());
}
function startGame(room, cfg) {
  const g = room.game;
  g.running = true; g.paused = false; g.cfg = cfg;
  g.roster = [];
  for (let s = 1; s <= MAX_PLAYERS; s++) if (room.slots[s]) g.roster.push({ slot: s, name: room.slots[s].name, team: room.slots[s].team });
  g.dead = {}; g.fields = {}; g.levels = {}; g.lossOrder = []; g.seconds = 0;
  for (const r of g.roster) g.levels[r.slot] = cfg.rules.startLevel;
  broadcast(room, { t: 'newgame', cfg, roster: g.roster });
  sys(room, '*** The Game Has Started');
  clearInterval(g.timer); g.timer = null;
  const minutes = cfg.rules.minutes | 0, every = Math.max(1, cfg.rules.seconds | 0);
  if (minutes > 0) {
    // "Minutes Before Lines Start Being Added" / "Seconds Between Lines Being Added" (GameEndTimer)
    g.timer = setInterval(() => {
      if (!g.running || g.paused) return;
      g.seconds++;
      if (minutes * 60 <= g.seconds && g.seconds % every === 0) broadcast(room, { t: 'sb', target: 0, sp: 'a', from: 0 });
    }, 1000);
  }
  listChanged();
}
function endGame(room, winner) {
  const g = room.game;
  if (!g.running) return;
  g.running = false; g.paused = false;
  clearInterval(g.timer); g.timer = null;
  broadcast(room, { t: 'endgame', winner, winlist: room.winlist });
  sys(room, '*** The Game Has Ended');
  listChanged();
}
function incWins(room) {
  const g = room.game, seen = new Set();
  let rank = 0;
  for (let i = g.lossOrder.length - 1; i >= 0; i--) {
    const r = rosterOf(room, g.lossOrder[i]);
    if (!r) continue;
    const key = r.team ? 't' + r.team : 'p' + r.name;
    if (key === 'p' || seen.has(key.toUpperCase())) continue;
    seen.add(key.toUpperCase());
    rank++;
    const pts = rank === 1 ? 3 : rank === 2 ? 2 : 1;
    let e = room.winlist.find(x => x.key.toUpperCase() === key.toUpperCase());
    if (!e) { e = { key, pts: 0 }; room.winlist.push(e); }
    e.pts += pts;
    if (rank === 3) break;
  }
  room.winlist.sort((a, b) => b.pts - a.pts);
}
function playerLost(room, slot) {
  const g = room.game;
  if (!inGame(room, slot) || g.dead[slot]) return;
  g.dead[slot] = true;
  g.lossOrder.push(slot);
  broadcast(room, { t: 'playerlost', slot });
  const all = g.roster.map(r => r.slot);
  const alive = all.filter(s => !g.dead[s]);
  if (!alive.length) return endGame(room, 0);
  const first = alive[0];
  const mixed = alive.slice(1).some(s => !sameTeam(room, first, s));
  if (!mixed && alive.length !== all.length) {   // same rule as the original (0x442074)
    g.lossOrder.push(first);
    incWins(room);
    endGame(room, first);
  }
}
function validCfg(c) {
  if (!c || typeof c !== 'object' || !c.rules || typeof c.rules !== 'object') return false;
  if (typeof c.pieceDist !== 'string' || !/^[1-7]{100}$/.test(c.pieceDist)) return false;
  if (typeof c.specDist !== 'string' || !/^[1-9]{100}$/.test(c.specDist)) return false;
  const r = c.rules, int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  return int(r.startLevel, 1, 100) && int(r.linesPerLevel, 1, 100) && int(r.levelInc, 0, 50) &&
    int(r.linesPerSpecial, 1, 50) && int(r.specialsPerTime, 0, 50) && int(r.capacity, 0, 18) &&
    int(r.minutes, 0, 60) && int(r.seconds, 1, 300) && typeof r.classic === 'boolean' && typeof r.averaged === 'boolean' &&
    Array.isArray(r.stacks) && r.stacks.length === 6 && r.stacks.every(v => int(v, 0, 22));
}
function cleanCfg(c) {
  const r = c.rules;
  return {
    rules: {
      startLevel: r.startLevel, linesPerLevel: r.linesPerLevel, levelInc: r.levelInc, averaged: r.averaged,
      linesPerSpecial: r.linesPerSpecial, specialsPerTime: r.specialsPerTime, capacity: r.capacity,
      classic: r.classic, minutes: r.minutes, seconds: r.seconds, stacks: r.stacks.slice()
    },
    pieceDist: c.pieceDist, specDist: c.specDist
  };
}

/* ---------- entering / leaving rooms ---------- */
function validNick(room, name) {
  if (!name) return 'Please enter a nickname.';
  for (let s = 1; s <= MAX_PLAYERS; s++)
    if (room.slots[s] && room.slots[s].name.toUpperCase() === name.toUpperCase()) return 'Nickname already exists on server!';
  return null;
}
function enterRoom(ws, room, name, team) {
  let free = 0;
  for (let s = 1; s <= MAX_PLAYERS; s++) if (!room.slots[s]) { free = s; break; }
  if (!free) return send(ws, { t: 'error', text: 'Server is full!' });
  room.slots[free] = { ws, name, team, order: room.joinOrder++ };
  room.emptySince = 0;
  ws.room = room; ws.slot = free;
  browsers.delete(ws);
  const g = room.game;
  send(ws, {
    t: 'welcome', slot: free, winlist: room.winlist,
    room: { id: room.id, name: room.name, private: room.private },
    game: g.running ? { cfg: g.cfg, roster: g.roster, fields: g.fields, dead: g.dead, levels: g.levels, paused: g.paused } : null
  });
  broadcast(room, playersMsg(room));
  sys(room, '*** ' + name + ' is Now Playing' + (team ? ' on Team ' + team : ''));
  listChanged();
}
function leaveRoom(ws) {
  const room = ws.room, s = ws.slot;
  if (!room || !s || !room.slots[s] || room.slots[s].ws !== ws) { ws.room = null; ws.slot = 0; return; }
  const name = room.slots[s].name;
  if (inGame(room, s) && !room.game.dead[s]) playerLost(room, s);
  room.slots[s] = null;
  ws.room = null; ws.slot = 0;
  broadcast(room, { t: 'playerleave', slot: s });
  broadcast(room, playersMsg(room));
  sys(room, '*** ' + name + ' Has Left');
  if (!count(room)) { endGame(room, 0); room.emptySince = Date.now(); }
  listChanged();
}

/* ---------- connections ---------- */
const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

wss.on('connection', ws => {
  ws.room = null; ws.slot = 0; ws.isAlive = true;
  browsers.add(ws);
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    /* ----- landing page ----- */
    if (!ws.room) {
      switch (m.t) {
        case 'list':
          send(ws, { t: 'rooms', rooms: publicList() });
          return;
        case 'info': {                         // invite link: what is this room?
          const id = clean(m.room, 6).toUpperCase(), room = rooms.get(id);
          if (!room) return send(ws, { t: 'info', room: id, exists: false });
          return send(ws, { t: 'info', exists: true, ...roomSummary(room) });
        }
        case 'create': {
          const name = clean(m.name, 30), team = clean(m.team, 30);
          const isPrivate = !!m.private, password = String(m.password || '');
          let roomName = clean(m.roomName, 40) || (name ? name + "'s game" : '');
          if (!name) return send(ws, { t: 'error', text: 'Please enter a nickname.' });
          if (isPrivate && (password.length < 1 || password.length > 40)) return send(ws, { t: 'error', text: 'Private games need a password (up to 40 characters).' });
          let alive = 0; for (const r of rooms.values()) if (count(r)) alive++;
          if (alive >= MAX_ROOMS) return send(ws, { t: 'error', text: 'The server is busy. Please try again later.' });
          const room = makeRoom(roomName, isPrivate, password);
          enterRoom(ws, room, name, team);
          return;
        }
        case 'join': {
          const id = clean(m.room, 6).toUpperCase(), room = rooms.get(id);
          const name = clean(m.name, 30), team = clean(m.team, 30);
          if (!ROOM_ID_RE.test(id) || !room) return send(ws, { t: 'error', text: 'That game no longer exists.', code: 'noroom' });
          const bad = validNick(room, name);
          if (bad) return send(ws, { t: 'error', text: bad });
          if (room.private && !checkPassword(room, m.password)) return send(ws, { t: 'error', text: 'Wrong password for this private game.', code: 'password' });
          enterRoom(ws, room, name, team);
          return;
        }
        case 'ping': return;
      }
      return;
    }

    /* ----- inside a room ----- */
    const room = ws.room, me = ws.slot, g = room.game;
    switch (m.t) {
      case 'ping': break;
      case 'leave':
        leaveRoom(ws);
        browsers.add(ws);
        send(ws, { t: 'left' });
        send(ws, { t: 'rooms', rooms: publicList() });
        break;
      case 'team': {
        const team = clean(m.team, 30);
        room.slots[me].team = team;
        broadcast(room, playersMsg(room));
        sys(room, '*** ' + room.slots[me].name + (team ? ' is Now on Team ' + team : ' is Now Alone'));
        break;
      }
      case 'pline': {
        const text = clean(m.text, 300);
        if (text) broadcast(room, { t: 'pline', from: me, text, act: !!m.act });
        break;
      }
      case 'gmsg': {
        const text = clean(m.text, 200);
        if (text) broadcast(room, { t: 'gmsg', from: me, text, act: !!m.act });
        break;
      }
      case 'start':
        if (me !== moderator(room) || g.running) break;
        if (!validCfg(m.cfg)) { send(ws, { t: 'error', text: 'Those server settings are not valid.' }); break; }
        startGame(room, cleanCfg(m.cfg));
        break;
      case 'stop':
        if (me === moderator(room) && g.running) endGame(room, 0);
        break;
      case 'pause':
        if (me !== moderator(room) || !g.running) break;
        g.paused = !!m.on;
        broadcast(room, { t: 'pause', on: g.paused });
        sys(room, g.paused ? '*** The Game Has Been Paused' : '*** The Game Has Been Unpaused');
        break;
      case 'f':
        if (!inGame(room, me) || typeof m.field !== 'string' || !FIELD_RE.test(m.field)) break;
        g.fields[me] = m.field;
        broadcast(room, { t: 'f', from: me, field: m.field }, me);
        break;
      case 'sb': {
        if (!inGame(room, me) || g.dead[me] || g.paused) break;
        const target = m.target | 0, sp = String(m.sp || '');
        if (target < 0 || target > MAX_PLAYERS || !SP_RE.test(sp)) break;
        if (target && (!inGame(room, target) || g.dead[target])) break;
        broadcast(room, { t: 'sb', target, sp, from: me }, me);
        break;
      }
      case 'lvl': {
        if (!inGame(room, me)) break;
        const lvl = m.level | 0;
        if (lvl < 1 || lvl > 100000) break;
        g.levels[me] = lvl;
        broadcast(room, { t: 'lvl', from: me, level: lvl }, me);
        break;
      }
      case 'playerlost':
        playerLost(room, me);
        break;
      case 'kick': {
        const target = m.slot | 0;
        if (me !== moderator(room) || target === me || !room.slots[target]) break;
        const kws = room.slots[target].ws;
        sys(room, '*** ' + room.slots[target].name + ' Has Been Kicked');
        leaveRoom(kws);
        browsers.add(kws);
        send(kws, { t: 'kicked' });
        send(kws, { t: 'rooms', rooms: publicList() });
        break;
      }
    }
  });

  ws.on('close', () => {
    browsers.delete(ws);
    if (ws.room) leaveRoom(ws);
  });
});

// drop dead connections (sleeping laptops, lost Wi-Fi) so their seat frees up
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 30000);

// remove rooms that have been empty for a while
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, r] of rooms) if (!count(r) && r.emptySince && now - r.emptySince > EMPTY_ROOM_TTL) {
    clearInterval(r.game.timer); rooms.delete(id); changed = true;
  }
  if (changed) listChanged();
}, 15000);

server.listen(PORT, () => console.log('TetriNET server listening on port ' + PORT));
