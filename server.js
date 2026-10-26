'use strict';
/*
 * IKEA RACE – realtime server (Express + Socket.io)
 * - Authoritative top-down physics at 60 Hz, state broadcast at ~30 fps
 * - Phones send gas/tilt at ~10 Hz, power-up use as an event
 * - Single room, everything in memory
 * - Quiz integration: see the "QUIZ INTEGRATION HOOKS" section below
 */
const path = require('path');
const http = require('http');
const https = require('https');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const fs = require('fs');
// files can live in ./public or, if uploaded flat, next to server.js
const STATIC_DIR = fs.existsSync(path.join(__dirname, 'public', 'host.html')) ? path.join(__dirname, 'public') : __dirname;
const TR = require(path.join(STATIC_DIR, 'tracks.js'));

const PORT = Number(process.env.PORT) || 3000;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;   // phones need HTTPS for the gyroscope
// public address for the QR code: set automatically on Render, or by hand (e.g. a tunnel URL)
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '';
const HOSTED = !!(PUBLIC_URL || process.env.RENDER);
const LAPS = 2;                   // default; a track can set its own (laps: 3)
const lapsOf = () => game.track.laps || LAPS;
const MAX_PLAYERS = 20;
const COUNTDOWN_MS = 4500;        // 1.5s intro (+ tilt calibration if used) + 3-2-1
const RACE_TIMEOUT_MS = 240000;   // safety net
const BOXES_PER_ROW = 4;
const COLORS = ['#E4002B', '#0058A3', '#FFDB00', '#00A651', '#FF7A00', '#8E44AD', '#00B5C8', '#FF5FA2', '#5D4037', '#222222',
  '#FFFFFF', '#7CB342', '#1A237E', '#F48FB1', '#00897B', '#B71C1C', '#9E9E9E', '#FFB74D', '#4FC3F7', '#C0CA33'];
const BOT_NAMES = ['BILLY', 'KALLAX', 'POÄNG', 'LACK', 'MALM', 'EKTORP', 'HEMNES', 'BRIMNES', 'IVAR', 'PAX', 'SÖDERHAMN', 'FRIHETEN', 'LINNMON', 'ALEX', 'BEKANT', 'STUVA', 'TROFAST', 'NORDLI', 'KLIPPAN', 'MARKUS'];
// identical for every car – only the color changes
const CAR = { accel: 300, brake: 440, maxSpeed: 280, turn: 2.8, r: 14 };

/* =====================================================================
 * QUIZ INTEGRATION HOOKS – replace / override from the quiz app:
 *   const race = require('./server'); race.hooks.getStartingGrid = myFn;
 * ===================================================================== */
const hooks = {
  /** Starting grid order (pole first). RANDOM for testing.
   *  TODO(quiz): order players by quiz score. */
  getStartingGrid(players) {
    const a = players.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  },
  /** TODO(quiz): winner bonus logic plugs in here (bonus type still undecided). */
  applyWinnerBonus(winner) {
    if (winner) console.log(`[hook] applyWinnerBonus → ${winner.name} (${winner.playerId})`);
  },
  /** Optional: called with the results array after "race_finished" is emitted. */
  onRaceFinished: null,
  /** Optional: called when the host presses CONTINUE (back to the quiz flow). */
  onContinue: null
};

/* ---------- server setup ---------- */
const app = express();
app.use(express.static(STATIC_DIR));
app.get('/three.min.js', (req, res) => res.sendFile(path.join(path.dirname(require.resolve('three')), 'three.min.js')));
app.get('/', (req, res) => res.redirect('/host.html'));
app.get('/play', (req, res) => res.redirect('/player.html' + (req.query.code ? '?code=' + encodeURIComponent(req.query.code) : '')));

const httpServer = http.createServer(app);
const io = new Server(httpServer);
let httpsServer = null;

function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}
function playerUrl(headers) {
  if (PUBLIC_URL) return PUBLIC_URL.replace(/\/$/, '') + '/player.html?code=' + game.code;
  // behind any HTTPS hosting proxy: reuse the address the host page was opened with
  if (headers && headers['x-forwarded-proto'] === 'https' && headers.host) return `https://${headers.host}/player.html?code=${game.code}`;
  return httpsServer ? `https://${lanIp()}:${HTTPS_PORT}/player.html?code=${game.code}`
                     : `http://${lanIp()}:${PORT}/player.html?code=${game.code}`;
}

/* ---------- helpers ---------- */
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const angNorm = a => Math.atan2(Math.sin(a), Math.cos(a));
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
let UID = 1;
const uid = () => UID++;

/* ---------- game state ---------- */
const game = {
  code: String(Math.floor(1000 + Math.random() * 9000)),
  phase: 'lobby',               // lobby | countdown | race | results
  trackId: TR.list[0].id,
  track: TR.list[0],
  players: new Map(),
  boxes: [], projectiles: [], traps: [], events: [], drops: [],
  goAt: 0, raceStart: 0, finishedCount: 0, nextEventAt: 0, order: [], results: null
};

const racers = () => [...game.players.values()].filter(p => !p.finished);
const colorTaken = c => [...game.players.values()].some(p => p.color === c);

function newPlayer(o) {
  const p = { id: o.id || 'p' + uid(), name: o.name, color: o.color, bot: !!o.bot, socketId: o.socketId || null, connected: true };
  resetRacer(p);
  return p;
}
function resetRacer(p) {
  Object.assign(p, {
    x: 0, y: 0, h: 0, vx: 0, vy: 0, lap: 0, prog: 0, lastS: 0, lapStart: 0, lapTimes: [],
    finished: false, finishTime: null, rank: 0, place: 0, item: null, itemReadyAt: 0, onTrack: true,
    boostUntil: 0, boostMul: 1, boostKind: 0, slowUntil: 0, slowMul: 1, slideUntil: 0, spinDir: 1,
    stunUntil: 0, inviUntil: 0, ghostUntil: 0, jumpUntil: 0, jumpStart: 0, jumpDur: 0, airborne: false, trick: false, throwsLeft: 0,
    stuckT: 0, botItemAt: 0, botThrowAt: 0, botLane: rnd(-0.3, 0.3), botSkill: rnd(0.86, 1),
    input: { gas: false, steer: 0, assist: true }
  });
}

function lobbyPayload() {
  return {
    code: game.code, phase: game.phase, trackId: game.trackId, laps: LAPS, colors: COLORS,
    players: [...game.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, connected: p.connected }))
  };
}
const broadcastLobby = () => io.emit('lobby', lobbyPayload());

function raceInfo(ms) {
  return {
    trackId: game.trackId, ms, laps: lapsOf(),
    players: [...game.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, grid: p.place }))
  };
}

function addBots(n) {
  for (let i = 0; i < n && game.players.size < MAX_PLAYERS; i++) {
    const color = COLORS.find(c => !colorTaken(c));
    const used = new Set([...game.players.values()].map(p => p.name));
    const name = BOT_NAMES.find(b => !used.has(b)) || 'BOT' + uid();
    const p = newPlayer({ name, color, bot: true });
    game.players.set(p.id, p);
  }
}

/* ---------- race lifecycle ---------- */
function startRace(trackId) {
  if (game.phase !== 'lobby') return 'Gara già in corso';
  const list = [...game.players.values()];
  if (list.length < 2) return 'Servono almeno 2 giocatori per partire';
  const tr = TR.byId[trackId] || game.track;
  game.track = tr; game.trackId = tr.id;
  const grid = hooks.getStartingGrid(list);
  grid.forEach((p, i) => {
    resetRacer(p);
    const row = Math.floor(i / 3), col = i % 3;
    const s = tr.L - 60 - row * 52 - col * 14;
    const pt = TR.pointAt(tr.main, s);
    const off = (col - 1) * Math.min(36, pt.w / 3.4);
    p.x = pt.x - Math.sin(pt.ang) * off; p.y = pt.y + Math.cos(pt.ang) * off; p.h = pt.ang;
    p.lastS = s; p.prog = s - tr.L; p.place = i + 1;
  });
  Object.assign(game, { boxes: makeBoxRows(tr), projectiles: [], traps: [], events: [], drops: [], finishedCount: 0, results: null });
  game.phase = 'countdown';
  game.goAt = Date.now() + COUNTDOWN_MS;
  game.order = grid.map(p => p.id);
  io.emit('race_countdown', raceInfo(COUNTDOWN_MS));
  return null;
}

function finishPlayer(p, now) {
  p.finished = true;
  p.finishTime = now - game.raceStart;
  p.rank = ++game.finishedCount;
  p.item = null;
  const N = game.players.size;
  p.throwsLeft = Math.max(1, Math.round(4 - 3 * (p.rank - 1) / Math.max(1, N - 1)));   // 1st=4 … last=1
  p.botThrowAt = now + rnd(1500, 3000);
  if (p.socketId) io.to(p.socketId).emit('sabotage_start', { rank: p.rank, throws: p.throwsLeft, time: p.finishTime });
  io.emit('fx', { k: 'finish', id: p.id, rank: p.rank, time: p.finishTime });
  // RACE END RULE: ends when the second-to-last player finishes
  if (game.finishedCount >= N - 1) endRace(now);
}

function endRace(now) {
  if (game.phase !== 'race') return;
  const rest = racers().sort((a, b) => b.prog - a.prog);
  rest.forEach(p => { p.rank = ++game.finishedCount; p.finishTime = null; });
  const results = [...game.players.values()].sort((a, b) => a.rank - b.rank).map(p => ({
    playerId: p.id, rank: p.rank, time: p.finishTime, name: p.name, color: p.color, bot: p.bot, lapTimes: p.lapTimes.slice()
  }));
  game.phase = 'results';
  game.results = { trackId: game.trackId, results };
  io.emit('race_finished', game.results);
  hooks.applyWinnerBonus(results[0]);
  if (typeof hooks.onRaceFinished === 'function') hooks.onRaceFinished(results);
}

function backToLobby() {
  game.phase = 'lobby';
  Object.assign(game, { boxes: [], projectiles: [], traps: [], events: [], drops: [] });
  for (const p of game.players.values()) resetRacer(p);
  for (const [id, p] of game.players) if (!p.bot && !p.connected) game.players.delete(id);
  broadcastLobby();
}

/* ---------- item boxes: Mario-Kart style rows across the road ---------- */
function makeBoxRows(tr) {
  const out = [];
  for (const f of tr.rows) {
    const pt = TR.pointAt(tr.main, f * tr.L), nx = -Math.sin(pt.ang), ny = Math.cos(pt.ang);
    const n = pt.w > 140 ? BOXES_PER_ROW + 1 : BOXES_PER_ROW, span = pt.w - 34;
    for (let i = 0; i < n; i++) {
      const off = -span / 2 + span * (i + 0.5) / n;
      out.push({ id: uid(), x: pt.x + nx * off, y: pt.y + ny * off, active: true, respawnAt: 0 });
    }
  }
  return out;
}
// better items for whoever is behind (like Mario Kart)
const STRONG = { KOTTBULLAR_3: 1, KOTTBULLAR_GOLD: 1, PILLOW_RED: 1, HOTDOG: 1, CART: 1, SWEDISH_FLAG: 1, FRAKTA_BAG: 1 };
function randomItem(p) {
  const n = Math.max(1, game.players.size - 1), f = p ? (p.place - 1) / n : 0.5;    // 0 = leader, 1 = last
  const w = Object.entries(TR.ITEMS).map(([k, v]) => [k, v.weight * (STRONG[k] ? 0.35 + 1.6 * f : 1.5 - 1.0 * f)]);
  let r = Math.random() * w.reduce((a, b) => a + b[1], 0);
  for (const [k, v] of w) { r -= v; if (r < 0) return k; }
  return 'KOTTBULLAR_1';
}

/* ---------- power-ups ---------- */
function boost(p, now, ms, mul, kind) {
  p.boostUntil = Math.max(p.boostUntil, now + ms); p.boostMul = Math.max(now < p.boostUntil - ms ? p.boostMul : 1, mul); p.boostKind = kind;
}
function targetAhead(p) {
  let best = null;
  for (const o of racers()) if (o !== p && o.prog > p.prog && (!best || o.prog < best.prog)) best = o;
  return best;
}
function useItem(p, now) {
  if (!p.item || p.finished || game.phase !== 'race' || now < p.itemReadyAt) return;
  const it = p.item; p.item = null;
  const tr = game.track, fx = Math.cos(p.h), fy = Math.sin(p.h);
  switch (it) {
    case 'KOTTBULLAR_1': boost(p, now, 2000, 1.3, 1); break;
    case 'KOTTBULLAR_3': boost(p, now, 3000, 1.5, 2); break;
    case 'KOTTBULLAR_GOLD': boost(p, now, 6000, 1.45, 3); break;
    case 'PILLOW_GREEN':
      game.projectiles.push({ id: uid(), type: 'green', owner: p.id, x: p.x + fx * 18, y: p.y + fy * 18, h: p.h,
        vx: fx * 620 + p.vx * 0.3, vy: fy * 620 + p.vy * 0.3, age: 0, life: 2.2 });
      break;
    case 'PILLOW_RED': {
      const t = targetAhead(p);
      game.projectiles.push({ id: uid(), type: 'red', owner: p.id, target: t ? t.id : null, x: p.x + fx * 18, y: p.y + fy * 18,
        h: p.h, sp: 500, vx: fx * 500, vy: fy * 500, age: 0, life: 4.5 });
      break;
    }
    case 'MASH_POTATO':
      game.traps.push({ id: uid(), type: 'mash', x: p.x - fx * 32, y: p.y - fy * 32, r: 18, armAt: now + 250 }); break;
    case 'DAJLIEN_BOX':
      game.traps.push({ id: uid(), type: 'box', x: p.x - fx * 32, y: p.y - fy * 32, r: 16, armAt: now + 250 }); break;
    case 'HOTDOG': p.inviUntil = now + 4000; break;
    case 'CART': {
      const jump = 340, pt = TR.pointAt(tr.main, p.lastS + jump);
      io.emit('fx', { k: 'flame', x: p.x, y: p.y, h: p.h });
      const sp = Math.max(240, Math.hypot(p.vx, p.vy));
      p.x = pt.x; p.y = pt.y; p.h = pt.ang; p.vx = Math.cos(pt.ang) * sp; p.vy = Math.sin(pt.ang) * sp;
      p.prog += jump; p.lastS = ((p.lastS + jump) % tr.L + tr.L) % tr.L;
      io.emit('fx', { k: 'flame', x: pt.x, y: pt.y, h: pt.ang });
      break;
    }
    case 'FRAKTA_BAG': p.ghostUntil = now + 3000; break;
    case 'SWEDISH_FLAG':
      for (const o of racers()) if (o !== p && now >= o.inviUntil) { o.slowUntil = now + 2000; o.slowMul = 0.5; }
      io.emit('fx', { k: 'flag', id: p.id });
      break;
  }
  io.emit('powerup_used', { playerId: p.id, item: it, x: r1(p.x), y: r1(p.y) });
}

// returns true if the effect landed
function hit(p, kind, now) {
  if (now < p.inviUntil) return false;
  if (now < p.ghostUntil && kind !== 'forklift' && kind !== 'launch') return false;
  p.spinDir = Math.random() < 0.5 ? -1 : 1;
  switch (kind) {
    case 'pillow': p.slowUntil = now + 1500; p.slowMul = 0.45; p.slideUntil = now + 350; break;
    case 'mash': p.slideUntil = now + 1000; break;
    case 'box': p.stunUntil = now + 1000; p.vx *= 0.05; p.vy *= 0.05; break;
    case 'forklift': p.stunUntil = now + 500; break;
    case 'cart': p.slowUntil = now + 1000; p.slowMul = 0.6; p.slideUntil = now + 300; break;
    case 'launch': p.stunUntil = now + 700; p.slideUntil = now + 700; break;
  }
  io.emit('fx', { k: 'hit', kind, id: p.id, x: r1(p.x), y: r1(p.y) });
  return true;
}

/* ---------- physics ---------- */
function physics(p, dt, now, tr) {
  let gas = p.input.gas, steer = p.input.steer;
  if (!p.bot && p.input.assist && Math.abs(steer) < 0.15 && gas) steer = assistSteer(p, tr);      // EASY: follows the road when you let go
  const stunned = now < p.stunUntil, sliding = now < p.slideUntil, jumping = now < p.jumpUntil;
  if (stunned) gas = false;
  const speed = Math.hypot(p.vx, p.vy);
  const fwd0 = p.vx * Math.cos(p.h) + p.vy * Math.sin(p.h);
  if (sliding) p.h += p.spinDir * 7 * dt;
  else if (!stunned && !jumping) {
    const sf = Math.max(0.35, Math.min(1, Math.abs(fwd0) / 50));
    const turn = CAR.turn * (1 - 0.5 * Math.min(1, speed / CAR.maxSpeed));   // less steering at high speed → brake!
    p.h += steer * turn * sf * dt * (fwd0 < -5 ? -1 : 1);
  }
  const fx = Math.cos(p.h), fy = Math.sin(p.h);
  let fwd = p.vx * fx + p.vy * fy, lat = -p.vx * fy + p.vy * fx;
  p.onTrack = jumping || TR.clearance(tr, p.x, p.y) < 4;
  const boosting = now < p.boostUntil;
  let max = CAR.maxSpeed * (tr.speed || 1);
  if (boosting) max *= p.boostMul;
  if (now < p.slowUntil) max *= p.slowMul;
  if (now < p.inviUntil) max *= 1.15;
  if (!p.onTrack) max *= 0.55;                      // off the road, on the carpet: slower
  if (gas || boosting) fwd += CAR.accel * (boosting ? 1.8 : 1) * dt;
  else fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), CAR.brake * dt);   // releasing gas = brake
  if (fwd > max) fwd -= Math.min(fwd - max, (p.onTrack ? 380 : 600) * dt);
  if (fwd < -40) fwd = -40;
  const grip = sliding ? 0.6 : jumping ? 0.5 : tr.grip;
  lat *= Math.exp(-grip * dt);
  p.vx = fx * fwd - fy * lat; p.vy = fy * fwd + fx * lat;
  p.x += p.vx * dt; p.y += p.vy * dt;
  wallCollide(p, tr);
  const W = TR.WORLD.w, H = TR.WORLD.h, m = 12;
  if (p.x < m) { p.x = m; p.vx = Math.abs(p.vx) * 0.3; }
  if (p.x > W - m) { p.x = W - m; p.vx = -Math.abs(p.vx) * 0.3; }
  if (p.y < m) { p.y = m; p.vy = Math.abs(p.vy) * 0.3; }
  if (p.y > H - m) { p.y = H - m; p.vy = -Math.abs(p.vy) * 0.3; }
}

// the edges of the road are solid walls (shelves, partitions): slide along them
function wallCollide(p, tr) {
  const e = TR.nearestEdge(tr, p.x, p.y), lim = e.hw + TR.shoulderAt(e) - CAR.r;
  if (e.d <= lim || e.d < 0.001) return;
  const nx = (p.x - e.px) / e.d, ny = (p.y - e.py) / e.d;
  p.x = e.px + nx * lim; p.y = e.py + ny * lim;
  const vn = p.vx * nx + p.vy * ny;
  if (vn > 0) {
    p.vx -= 1.25 * vn * nx; p.vy -= 1.25 * vn * ny;
    p.vx *= 0.96; p.vy *= 0.96;
    if (vn > 120 && Date.now() - (p.lastBonk || 0) > 300) { p.lastBonk = Date.now(); io.emit('fx', { k: 'wall', x: r1(p.x + nx * CAR.r), y: r1(p.y + ny * CAR.r) }); }
  }
}

// steering assist: keeps your lane and follows the road ahead, away from the walls
function assistSteer(p, tr) {
  const e = TR.nearestEdge(tr, p.x, p.y);
  if (tr.branch && e !== undefined && TR.projectPath(tr.branch, p.x, p.y).d < TR.projectPath(tr.main, p.x, p.y).d) return 0;
  const spd = Math.hypot(p.vx, p.vy);
  const q = TR.pointAt(tr.main, p.lastS), qn = [-Math.sin(q.ang), Math.cos(q.ang)];
  const lat = clamp((p.x - q.x) * qn[0] + (p.y - q.y) * qn[1], -(q.w / 2 - 40), q.w / 2 - 40);
  const t = TR.pointAt(tr.main, p.lastS + 90 + spd * 0.3);
  const tx = t.x - Math.sin(t.ang) * lat, ty = t.y + Math.cos(t.ang) * lat;
  const err = angNorm(Math.atan2(ty - p.y, tx - p.x) - p.h);
  return clamp(err * 2, -0.85, 0.85);
}

function launch(victim, src, now) {
  if (!hit(victim, 'launch', now)) return;
  const dx = victim.x - src.x, dy = victim.y - src.y, d = Math.hypot(dx, dy) || 1;
  victim.vx = dx / d * 240 - Math.cos(victim.h) * 130;
  victim.vy = dy / d * 240 - Math.sin(victim.h) * 130;
}

function carCollisions(list, now) {
  const R = CAR.r;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (now < a.ghostUntil || now < b.ghostUntil || now < a.jumpUntil || now < b.jumpUntil) continue;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d >= 2 * R || d < 0.01) continue;
    const nx = dx / d, ny = dy / d, ov = (2 * R - d) / 2;
    a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
    const ai = now < a.inviUntil, bi = now < b.inviUntil;
    if (ai && !bi) { launch(b, a, now); continue; }
    if (bi && !ai) { launch(a, b, now); continue; }
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv < 0) {
      const J = -(1 + 0.6) * rv / 2 + 20;   // deflect both cars
      a.vx -= J * nx; a.vy -= J * ny; b.vx += J * nx; b.vy += J * ny;
    }
  }
}

function eventObstacles(now) {
  const out = [];
  for (const e of game.events) {
    if (e.type === 'forklift') out.push({ x: e.x, y: e.y, r: 26, ev: 'forklift' });
    else if (e.type === 'cart') out.push({ x: e.x, y: e.y, r: 16, ev: 'cart' });
    else if (e.type === 'shelf' && now >= e.warnUntil) for (const c of e.circles) out.push({ x: c.x, y: c.y, r: c.r, ev: 'shelf' });
  }
  return out;
}

function collideCircle(p, o, now) {
  const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy), rr = o.r + CAR.r;
  if (d >= rr || d < 0.001) return;
  if (now < p.inviUntil || now < p.jumpUntil) return;    // hot dog passes through everything
  const nx = dx / d, ny = dy / d;
  p.x = o.x + nx * rr; p.y = o.y + ny * rr;
  const vn = p.vx * nx + p.vy * ny;
  if (vn < 0) {
    const soft = o.kind === 'soft', e = soft ? 0.25 : 0.45, keep = soft ? 0.9 : 0.75;
    p.vx -= (1 + e) * vn * nx; p.vy -= (1 + e) * vn * ny; p.vx *= keep; p.vy *= keep;
    if (o.ev === 'forklift') hit(p, 'forklift', now);
    else if (o.ev === 'cart') hit(p, 'cart', now);
    else if (-vn > 50) io.emit('fx', { k: 'bonk', x: r1(o.x), y: r1(o.y), soft });
  }
}

/* ---------- random track events ---------- */
function spawnEvent(now) {
  const tr = game.track, list = racers();
  if (!list.length) return;
  const type = Math.random() < 0.4 ? tr.signature : tr.events[Math.floor(Math.random() * tr.events.length)];
  const who = list[Math.floor(Math.random() * list.length)];
  const ahead = (d) => TR.pointAt(tr.main, who.lastS + d);
  let ev = null;
  switch (type) {
    case 'forklift': {
      const pt = ahead(rnd(380, 600)), nx = -Math.sin(pt.ang), ny = Math.cos(pt.ang), dir = Math.random() < 0.5 ? 1 : -1;
      const reach = pt.w / 2 + 40, sp = 110;
      ev = { type, x: pt.x - nx * reach * dir, y: pt.y - ny * reach * dir, vx: nx * sp * dir, vy: ny * sp * dir,
        a: Math.atan2(ny * dir, nx * dir), until: now + (2 * reach / sp) * 1000 };
      break;
    }
    case 'shelf': {
      const pt = ahead(rnd(450, 650)), side = Math.random() < 0.5 ? 1 : -1, hw = pt.w / 2;
      const nx = -Math.sin(pt.ang), ny = Math.cos(pt.ang);
      const circles = [0.2, 0.5, 0.8].map(f => ({ x: pt.x + nx * side * hw * f, y: pt.y + ny * side * hw * f, r: hw * 0.17 + 4 }));
      ev = { type, x: pt.x + nx * side * hw * 0.5, y: pt.y + ny * side * hw * 0.5, a: pt.ang, len: hw, circles,
        warnUntil: now + 1200, until: now + 7000 };
      break;
    }
    case 'cart': {
      const s = who.lastS + rnd(500, 750), pt = TR.pointAt(tr.main, s);
      ev = { type, s, off: rnd(-0.3, 0.3) * pt.w, sp: -170, x: pt.x, y: pt.y, a: pt.ang + Math.PI, until: now + 6000 };
      break;
    }
    case 'icecream':
      ev = { type, target: who.id, x: who.x, y: who.y, a: 0, until: now + 1900 };
      if (who.socketId) io.to(who.socketId).emit('icecream', { ms: 1800 });
      if (who.bot) setTimeout(() => catchIce(who, Math.random() < 0.55), rnd(700, 1600));
      break;
    case 'blackout':
      io.emit('blackout', { ms: 1000 });
      ev = { type, x: 0, y: 0, a: 0, until: now + 1000 };
      break;
    case 'cleaning': {
      const t = game.traps[Math.floor(Math.random() * game.traps.length)];
      const s = t ? TR.progressS(tr, t.x, t.y).s - 180 : who.lastS + rnd(300, 600);
      ev = { type, s, x: 0, y: 0, a: 0, until: now + 5500 };
      break;
    }
  }
  if (ev) { ev.id = uid(); game.events.push(ev); }
  io.emit('fx', { k: 'event', ev: type });
}

function doTrick(p) {
  const now = Date.now();
  if (game.phase !== 'race' || !p.airborne || p.trick || now > p.jumpUntil - 150) return;
  p.trick = true;
  io.emit('fx', { k: 'trick', id: p.id });
}

function catchIce(p, ok) {
  const now = Date.now();
  const e = game.events.find(e => e.type === 'icecream' && e.target === p.id && !e.done);
  if (!e || game.phase !== 'race' || p.finished) return;
  e.done = true; e.until = now;
  if (ok) { boost(p, now, 1500, 1.3, 1); io.emit('fx', { k: 'catch', id: p.id }); }
}

function updateEvents(now, dt, tr) {
  for (const e of game.events) {
    if (now >= e.until) { e.dead = true; continue; }
    if (e.type === 'forklift') { e.x += e.vx * dt; e.y += e.vy * dt; }
    else if (e.type === 'cart' || e.type === 'cleaning') {
      e.s += (e.type === 'cart' ? e.sp : 100) * dt;
      const pt = TR.pointAt(tr.main, e.s), off = e.off || 0;
      e.x = pt.x - Math.sin(pt.ang) * off; e.y = pt.y + Math.cos(pt.ang) * off;
      e.a = e.type === 'cart' ? pt.ang + Math.PI : pt.ang;
      if (e.type === 'cleaning') {
        const before = game.traps.length;
        game.traps = game.traps.filter(t => Math.hypot(t.x - e.x, t.y - e.y) > pt.w / 2 + 10);
        if (game.traps.length < before) io.emit('fx', { k: 'clean', x: r1(e.x), y: r1(e.y) });
      }
    } else if (e.type === 'icecream') {
      const t = game.players.get(e.target);
      if (t) { e.x = t.x; e.y = t.y; }
    }
  }
  game.events = game.events.filter(e => !e.dead);
}

/* ---------- bots (demo mode) ---------- */
function botThink(p, now, dt, tr) {
  const spd = Math.hypot(p.vx, p.vy), s = p.lastS;
  const look = TR.pointAt(tr.main, s + 60 + spd * 0.3);
  const lane = p.botLane * look.w * 0.5;
  const tx = look.x - Math.sin(look.ang) * lane, ty = look.y + Math.cos(look.ang) * lane;
  const err = angNorm(Math.atan2(ty - p.y, tx - p.x) - p.h);
  p.input.steer = clamp(err * 2.5, -1, 1);
  const near = TR.pointAt(tr.main, s + 20), far = TR.pointAt(tr.main, s + 90 + spd * 0.55);
  const bend = Math.abs(angNorm(far.ang - near.ang));
  const slip = tr.grip < 4 ? 0.8 : 1;
  const target = CAR.maxSpeed * (tr.speed || 1) * p.botSkill * clamp(1.05 - bend * 0.45 / slip, 0.4, 1);
  p.input.gas = spd < target || !p.onTrack;
  if (Math.random() < 0.004) p.botLane = rnd(-0.35, 0.35);
  // stuck → put back on the centerline
  if (spd < 20 && now > p.stunUntil) p.stuckT += dt; else p.stuckT = 0;
  if (p.stuckT > 1.6) {
    const pt = TR.pointAt(tr.main, s);
    p.x = pt.x; p.y = pt.y; p.h = pt.ang; p.vx = p.vy = 0; p.stuckT = 0;
  }
  if (p.item && !p.botItemAt) p.botItemAt = now + rnd(1500, 4000);
  if (p.item && now >= p.botItemAt) { p.botItemAt = 0; useItem(p, now); }
}
function botSabotage(p, now) {
  if (p.throwsLeft <= 0 || now < p.botThrowAt) return;
  const list = racers();
  if (!list.length) return;
  const t = list[Math.floor(Math.random() * list.length)];
  const types = ['mash', 'pillow', 'box'];
  throwItem(p, types[Math.floor(Math.random() * 3)], t.x + t.vx * 0.7, t.y + t.vy * 0.7, now);
  p.botThrowAt = now + rnd(2500, 4500);
}

/* ---------- sabotage ---------- */
function throwItem(p, type, x, y, now) {
  if (game.phase !== 'race' || !p.finished || p.throwsLeft <= 0) return;
  if (!['mash', 'pillow', 'box'].includes(type)) return;
  x = clamp(+x || 0, 0, TR.WORLD.w); y = clamp(+y || 0, 0, TR.WORLD.h);
  game.drops.push({ id: uid(), type, x, y, at: now + 700, by: p.id });
  p.throwsLeft--;
  io.emit('sabotage_throw', { playerId: p.id, type, x: r1(x), y: r1(y), left: p.throwsLeft });
}
function updateDrops(now) {
  for (const d of game.drops) {
    if (now < d.at) continue;
    d.dead = true;
    if (d.type === 'pillow') {
      for (const p of racers()) if (Math.hypot(p.x - d.x, p.y - d.y) < 50 && now >= p.jumpUntil) hit(p, 'pillow', now);
      io.emit('fx', { k: 'splash', x: r1(d.x), y: r1(d.y) });
    } else {
      game.traps.push({ id: uid(), type: d.type, x: d.x, y: d.y, r: d.type === 'box' ? 16 : 18, armAt: now });
    }
  }
  game.drops = game.drops.filter(d => !d.dead);
}

/* ---------- main step ---------- */
function rankAll() {
  const arr = [...game.players.values()];
  arr.sort((a, b) => (a.finished && b.finished) ? a.rank - b.rank : a.finished ? -1 : b.finished ? 1 : b.prog - a.prog);
  arr.forEach((p, i) => { p.place = i + 1; });
  game.order = arr.map(p => p.id);
}

function step(now, dt) {
  const tr = game.track, L = tr.L, active = racers();
  for (const p of active) if (p.bot) botThink(p, now, dt, tr);
  for (const p of active) physics(p, dt, now, tr);
  carCollisions(active, now);
  const obs = tr.obstacles.concat(eventObstacles(now));

  for (const p of active) {
    for (const o of obs) collideCircle(p, o, now);
    // ramps across the whole road: real airtime, trick in the air = boost on landing
    if (now >= p.jumpUntil) {
      if (p.airborne) {
        p.airborne = false;
        io.emit('fx', { k: 'land', id: p.id, x: r1(p.x), y: r1(p.y), trick: p.trick });
        if (p.trick) boost(p, now, 1100, 1.4, 1);
        p.trick = false;
      }
      for (const rp of tr.ramps) {
        let ds = p.lastS - rp.s; if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L;
        if (ds < 0 || ds > 30 || Math.hypot(p.x - rp.x, p.y - rp.y) > rp.w / 2 + 30) continue;
        const spd = Math.hypot(p.vx, p.vy);
        p.jumpDur = Math.round(clamp(700 + spd * 2.6, 1000, 1600));
        p.jumpStart = now; p.jumpUntil = now + p.jumpDur; p.airborne = true; p.trick = false;
        io.emit('fx', { k: 'jump', id: p.id });
        if (p.bot && Math.random() < 0.5) setTimeout(() => doTrick(p), rnd(150, 500));
        break;
      }
    }
    // pads (Småland)
    for (const pad of tr.pads) {
      if (Math.hypot(p.x - pad.x, p.y - pad.y) > pad.r + 6) continue;
      boost(p, now, 900, 1.35, 1);
    }
    // item boxes
    for (const b of game.boxes) {
      if (!b.active || Math.hypot(p.x - b.x, p.y - b.y) > 26) continue;
      b.active = false; b.respawnAt = now + 2200;            // the box breaks even if you already hold an item
      io.emit('fx', { k: 'box', x: r1(b.x), y: r1(b.y) });
      if (!p.item) {
        p.item = randomItem(p); p.itemReadyAt = now + 1100;  // roulette on the phone
        io.emit('powerup_collected', { playerId: p.id, item: p.item, x: r1(b.x), y: r1(b.y) });
      }
    }
    // traps
    if (now >= p.jumpUntil && now >= p.ghostUntil) {
      for (const t of game.traps) {
        if (t.dead || now < t.armAt || Math.hypot(p.x - t.x, p.y - t.y) > t.r + 11) continue;
        t.dead = true;
        if (now >= p.inviUntil) hit(p, t.type === 'mash' ? 'mash' : 'box', now);
      }
    }
    // lap progress (per-tick jump cap → cutting across the carpet doesn't pay)
    const pr = TR.progressS(tr, p.x, p.y);
    let ds = pr.s - p.lastS;
    if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
    const cap = Math.hypot(p.vx, p.vy) * dt * 3.5 + 10;
    p.prog += clamp(ds, -cap, cap);
    p.lastS = pr.s;
    if (p.prog >= (p.lap + 1) * L) {
      const lt = now - p.lapStart;
      p.lapTimes.push(lt); p.lapStart = now; p.lap++;
      io.emit('lap_completed', { playerId: p.id, lap: p.lap, time: lt });
      if (p.lap >= lapsOf()) { finishPlayer(p, now); if (game.phase !== 'race') return; }
    }
  }
  game.traps = game.traps.filter(t => !t.dead);

  // projectiles
  for (const q of game.projectiles) {
    q.age += dt;
    if (q.type === 'red') {
      const t = q.target && game.players.get(q.target);
      if (t && !t.finished) q.h += clamp(angNorm(Math.atan2(t.y - q.y, t.x - q.x) - q.h), -4.5 * dt, 4.5 * dt);
      q.vx = Math.cos(q.h) * q.sp; q.vy = Math.sin(q.h) * q.sp;
    }
    q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.age > q.life || q.x < 0 || q.y < 0 || q.x > TR.WORLD.w || q.y > TR.WORLD.h) { q.dead = true; continue; }
    if (obs.some(o => Math.hypot(q.x - o.x, q.y - o.y) < o.r + 6)) { q.dead = true; io.emit('fx', { k: 'poof', x: r1(q.x), y: r1(q.y) }); continue; }
    for (const p of racers()) {
      if ((p.id === q.owner && q.age < 0.5) || now < p.jumpUntil || now < p.ghostUntil) continue;
      if (Math.hypot(p.x - q.x, p.y - q.y) < 22) { q.dead = true; hit(p, 'pillow', now); break; }
    }
  }
  game.projectiles = game.projectiles.filter(q => !q.dead);

  updateDrops(now);
  updateEvents(now, dt, tr);
  if (now >= game.nextEventAt) { spawnEvent(now); game.nextEventAt = now + rnd(9000, 14000); }
  for (const b of game.boxes) if (!b.active && now >= b.respawnAt) b.active = true;
  for (const p of game.players.values()) if (p.bot && p.finished) botSabotage(p, now);
  rankAll();
  if (now - game.raceStart > RACE_TIMEOUT_MS) endRace(now);
}

let lastTick = Date.now();
function tick() {
  const now = Date.now(), dt = Math.min(0.05, (now - lastTick) / 1000);
  lastTick = now;
  if (game.phase === 'countdown' && now >= game.goAt) {
    game.phase = 'race'; game.raceStart = now;
    for (const p of game.players.values()) p.lapStart = now;
    game.nextEventAt = now + rnd(7000, 10000);
    io.emit('race_go');
  }
  if (game.phase === 'race') step(now, dt);
}

function flags(p, now) {
  let f = 0;
  if (now < p.boostUntil) { f |= 1; if (p.boostKind === 3) f |= 2; if (p.boostKind === 2) f |= 512; }
  if (now < p.slowUntil) f |= 4;
  if (now < p.slideUntil) f |= 8;
  if (now < p.inviUntil) f |= 16;
  if (now < p.ghostUntil) f |= 32;
  if (now < p.jumpUntil) f |= 64;
  if (!p.onTrack) f |= 128;
  if (now < p.stunUntil) f |= 256;
  if (p.trick) f |= 1024;
  return f;
}
function snapshot(now) {
  return {
    ph: game.phase,
    t: game.phase === 'race' ? now - game.raceStart : -(game.goAt - now),
    o: game.order,
    p: [...game.players.values()].map(p => ({
      i: p.id, x: r1(p.x), y: r1(p.y), h: r2(p.h), l: p.lap, it: p.item, f: flags(p, now),
      fin: p.finished ? 1 : 0, rk: p.rank, j: now < p.jumpUntil ? [now - p.jumpStart, p.jumpDur] : 0, ft: p.finishTime, sp: Math.round(Math.hypot(p.vx, p.vy)), th: p.throwsLeft
    })),
    b: game.boxes.filter(b => b.active).map(b => [Math.round(b.x), Math.round(b.y)]),
    q: game.projectiles.map(q => [Math.round(q.x), Math.round(q.y), q.type, r2(q.h || 0)]),
    tr: game.traps.map(t => [Math.round(t.x), Math.round(t.y), t.type]),
    d: game.drops.map(d => [Math.round(d.x), Math.round(d.y), d.type, d.at - now]),
    e: game.events.map(e => ({ k: e.type, x: r1(e.x), y: r1(e.y), a: r2(e.a || 0), w: e.warnUntil > now ? 1 : 0, len: e.len, tg: e.target }))
  };
}
function broadcast() {
  if (game.phase === 'race' || game.phase === 'countdown') io.emit('state', snapshot(Date.now()));
}

/* ---------- sockets ---------- */
io.on('connection', (s) => {
  s.emit('lobby', lobbyPayload());
  const reply = (ack) => (typeof ack === 'function' ? ack : () => {});
  const me = () => game.players.get(s.data.pid);
  const isHost = () => s.data.host === true;

  s.on('host_hello', async () => {
    s.data.host = true; s.join('host');
    const url = playerUrl(s.handshake.headers);
    let qr = '';
    try { qr = await QRCode.toDataURL(url, { margin: 1, width: 420, color: { dark: '#111111', light: '#FFFFFF' } }); } catch (e) { /* ignore */ }
    s.emit('room', { code: game.code, url, qr, laps: LAPS });
    s.emit('lobby', lobbyPayload());
    if (game.phase === 'countdown' || game.phase === 'race') s.emit('race_countdown', raceInfo(Math.max(0, game.goAt - Date.now())));
    if (game.phase === 'results') s.emit('race_finished', game.results);
  });

  s.on('join', (d = {}, ack) => {
    const cb = reply(ack);
    if (String(d.code || '').trim() !== game.code) return cb({ ok: false, error: 'Codice stanza errato' });
    if (game.phase !== 'lobby') return cb({ ok: false, error: 'Gara in corso – aspetta la prossima' });
    if (game.players.size >= MAX_PLAYERS) return cb({ ok: false, error: 'Stanza piena' });
    const name = String(d.name || '').trim().toUpperCase().slice(0, 12) || 'PILOTA';
    const color = COLORS.includes(d.color) && !colorTaken(d.color) ? d.color : COLORS.find(c => !colorTaken(c));
    const p = newPlayer({ name, color, socketId: s.id });
    game.players.set(p.id, p);
    s.data.pid = p.id; s.join('players');
    cb({ ok: true, id: p.id, name, color });
    broadcastLobby();
  });

  s.on('rejoin', (d = {}, ack) => {
    const cb = reply(ack), p = game.players.get(d.id);
    if (!p || p.bot) return cb({ ok: false });
    p.socketId = s.id; p.connected = true; s.data.pid = p.id; s.join('players');
    cb({ ok: true, id: p.id, name: p.name, color: p.color, phase: game.phase });
    if (game.phase === 'countdown' || game.phase === 'race') s.emit('race_countdown', raceInfo(Math.max(0, game.goAt - Date.now())));
    if (game.phase === 'race' && p.finished) s.emit('sabotage_start', { rank: p.rank, throws: p.throwsLeft, time: p.finishTime });
    if (game.phase === 'results') s.emit('race_finished', game.results);
    broadcastLobby();
  });

  s.on('select_track', (d = {}) => {
    if (!isHost() || game.phase !== 'lobby' || !TR.byId[d.trackId]) return;
    game.trackId = d.trackId; game.track = TR.byId[d.trackId];
    broadcastLobby();
  });
  s.on('demo_add', (d = {}) => { if (isHost() && game.phase === 'lobby') { addBots(clamp(+d.n || 3, 1, 7)); broadcastLobby(); } });
  s.on('demo_clear', () => {
    if (!isHost() || game.phase !== 'lobby') return;
    for (const [id, p] of game.players) if (p.bot) game.players.delete(id);
    broadcastLobby();
  });
  s.on('start_race', (d = {}) => {
    if (!isHost()) return;
    const err = startRace(d.trackId || game.trackId);
    if (err) s.emit('host_error', err);
  });
  s.on('abort_race', () => { if (isHost() && game.phase !== 'lobby') backToLobby(); });
  s.on('continue', () => {
    if (!isHost() || game.phase !== 'results') return;
    const results = game.results;
    io.emit('quiz_continue', results);                  // back to the quiz flow
    if (typeof hooks.onContinue === 'function') hooks.onContinue(results);
    backToLobby();
  });

  s.on('input', (d = {}) => {
    const p = me();
    if (!p) return;
    p.input.gas = !!d.gas;
    p.input.steer = clamp(Number(d.steer) || 0, -1, 1);
    p.input.assist = d.assist !== false;
  });
  s.on('powerup_used', () => { const p = me(); if (p) useItem(p, Date.now()); });
  s.on('trick', () => { const p = me(); if (p) doTrick(p); });
  s.on('catch', (d = {}) => { const p = me(); if (p) catchIce(p, !!d.ok); });
  s.on('sabotage_throw', (d = {}) => { const p = me(); if (p) throwItem(p, d.type, d.x, d.y, Date.now()); });

  s.on('disconnect', () => {
    const p = me();
    if (!p || p.socketId !== s.id) return;
    p.connected = false; p.input = { gas: false, steer: 0 };
    if (game.phase === 'lobby') {
      setTimeout(() => {      // grace period: phone screen lock / page refresh
        if (!p.connected && game.phase === 'lobby') { game.players.delete(p.id); broadcastLobby(); }
      }, 15000);
    }
    broadcastLobby();
  });
});

/* ---------- start ---------- */
let loops = null;
function start() {
  httpServer.listen(PORT, () => {
    console.log(`\n  IKEA RACE  ·  codice stanza ${game.code}`);
    console.log(HOSTED ? `  Online su ${PUBLIC_URL || 'porta ' + PORT}` : `  Host (proiettore):  http://localhost:${PORT}/host.html`);
  });
  if (!process.argv.includes('--no-https') && !HOSTED) {
    try {
      const selfsigned = require('selfsigned');
      const ip = lanIp();
      const pems = selfsigned.generate([{ name: 'commonName', value: ip }], {
        days: 365, keySize: 2048,
        extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip }, { type: 7, ip: '127.0.0.1' }, { type: 2, value: 'localhost' }] }]
      });
      httpsServer = https.createServer({ key: pems.private, cert: pems.public ? pems.cert : pems.cert }, app);
      io.attach(httpsServer);
      httpsServer.listen(HTTPS_PORT, () => console.log(`  Telefoni (HTTPS):   https://${ip}:${HTTPS_PORT}/player.html?code=${game.code}\n`));
    } catch (e) { console.warn('  HTTPS non disponibile:', e.message); }
  }
  if (PUBLIC_URL) console.log(`  Telefoni:           ${playerUrl()}\n`);
  if (process.argv.includes('--demo')) addBots(3);
  loops = [setInterval(tick, 1000 / 60), setInterval(broadcast, 1000 / 30)];
}

if (require.main === module) start();
module.exports = { start, hooks, game, io, app, _sim: { startRace, step, addBots, useItem, backToLobby, CAR } };
