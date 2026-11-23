'use strict';
/* =====================================================================
   BADMINTON ARENA 3D  —  tampilan dari belakang pemain, 1v1 s/d 2v2
   Dunia dalam METER:  x = kiri/kanan (layar),  z = kedalaman (net di z=0),
   y = tinggi.  Tim Biru ada di sisi dekat kamera (z<0), Tim Merah di sisi jauh (z>0).
   ===================================================================== */

// ---------- Konstanta -------------------------------------------------
const W = 1280, H = 720;
const CAM = { y: 7.2, z: -12.6, p: 0.5, F: 730, cy: 380 };   // kamera di belakang & di atas lapangan
const COSP = Math.cos(CAM.p), SINP = Math.sin(CAM.p);
const DT = 1 / 120;
const GRAV = 9.8, DRAG = 0.16;                 // shuttle: gravitasi & hambatan udara kuadratik (per meter)
const NET_H = 1.55, HL = 6.7;                  // tinggi net, setengah panjang lapangan
const PSPEED = 5.0, JUMP_V = 4.4, PGRAV = 11;  // pemain
const SW_T = 0.42, HIT_LO = 0.03, HIT_HI = 0.38; // durasi ayunan & jendela kontak
const REACH = 1.35, REACH_V = 2.75;            // jangkauan raket (silinder di sekitar pemain)

const TEAMS = [
  { name: 'Tim Biru',  shirt: '#2f7dff', shorts: '#16356e', accent: '#8cc2ff', band: '#ffffff' },
  { name: 'Tim Merah', shirt: '#ff4d5e', shorts: '#6e1620', accent: '#ffb1ba', band: '#ffe27a' }
];
const HAIR = ['#2a1d16', '#6b3f1d', '#c9a227', '#1b1b1f'];
const SKIN = ['#f2c9a0', '#d9a273', '#f6d5b5', '#b9825a'];
const KEYS = [
  { l: ['KeyA'], r: ['KeyD'], u: ['KeyW'], d: ['KeyS'], s: ['Space'] },                                   // P1 (Biru)
  { l: ['ArrowLeft'], r: ['ArrowRight'], u: ['ArrowUp'], d: ['ArrowDown'], s: ['ShiftRight', 'Enter', 'Numpad0'] }, // P2 (Merah)
  { l: ['KeyF'], r: ['KeyH'], u: ['KeyT'], d: ['KeyG'], s: ['KeyB'] },                                   // P3 (Biru, rekan)
  { l: ['KeyJ'], r: ['KeyL'], u: ['KeyI'], d: ['KeyK'], s: ['Semicolon', 'KeyN'] }                       // P4 (Merah, rekan)
];
const KEYLBL = [
  { move: 'W A S D', hit: 'Spasi' }, { move: '← ↑ ↓ →', hit: 'Shift kanan / Enter' },
  { move: 'T F G H', hit: 'B' }, { move: 'I J K L', hit: ';' }
];
const GAMEKEYS = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter']);

// ---------- Konfigurasi menu -----------------------------------------
let isTouchDevice = false;
try { isTouchDevice = (navigator.maxTouchPoints > 0) && window.matchMedia('(pointer:coarse)').matches; } catch (e) { /* bukan browser */ }
const cfg = { mode: 1, humans: [true, false, false, false], points: 11, games: 1, level: 1, marker: true, touch: isTouchDevice };
const LEVELS = [0.35, 0.7, 1.0];
const HW = () => (cfg.mode === 2 ? 3.05 : 2.59);          // setengah lebar lapangan yang dipakai

// ---------- Utilitas -------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
function proj(x, y, z) {
  const yc = y - CAM.y, zc = z - CAM.z;
  const y2 = yc * COSP + zc * SINP, z2 = zc * COSP - yc * SINP;
  const s = CAM.F / z2;
  return { x: W / 2 + x * s, y: CAM.cy - y2 * s, s };
}

// ---------- State global ---------------------------------------------
const keys = {};
const edge = {};
const G = {
  state: 'menu', paused: false, time: 0, players: [],
  shuttle: { x: 0, y: 1, z: -3, vx: 0, vy: 0, vz: 0 }, shAng: Math.PI / 2,
  score: [0, 0], games: [0, 0], gameNo: 1, serveTeam: 0, serverIdx: [0, 0], server: null,
  lastHitTeam: -1, lastHitter: null, lastHitTime: -9, lastType: '', rally: 0, netFlag: false, pred: null,
  timer: 0, after: 'serve', msg: null, gameWinner: -1, matchWinner: -1, serveSign: 1,
  parts: [], texts: [], trail: [], trailTick: 0, shake: 0, aiLevel: 0.7
};

// ---------- Fisika shuttlecock (3D) ----------------------------------
function integrate(s, dt) {
  const k = DRAG * Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz);
  s.vx -= k * s.vx * dt;
  s.vy += (-GRAV - k * s.vy) * dt;
  s.vz -= k * s.vz * dt;
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
}
// 'net' | 'ground' | null
function stepShuttle(s) {
  const px = s.x, py = s.y, pz = s.z;
  integrate(s, DT);
  if (pz !== s.z && pz * s.z <= 0) {
    const t = (0 - pz) / (s.z - pz);
    const yc = py + (s.y - py) * t, xc = px + (s.x - px) * t;
    if (yc <= NET_H + 0.02 && Math.abs(xc) <= 3.4) {      // menabrak net
      const side = pz < 0 ? -1 : 1;
      s.z = side * 0.04; s.x = xc;
      s.vz = -side * Math.abs(s.vz) * 0.06; s.vx *= 0.2; s.vy *= 0.2;
      return 'net';
    }
  }
  if (s.y <= 0) { s.y = 0; return 'ground'; }
  return null;
}
function predict() {
  const sh = G.shuttle, s = { x: sh.x, y: sh.y, z: sh.z, vx: sh.vx, vy: sh.vy, vz: sh.vz };
  const xs = [s.x], ys = [s.y], zs = [s.z];
  let end = 'time';
  for (let i = 0; i < 480; i++) {
    const ev = stepShuttle(s);
    xs.push(s.x); ys.push(s.y); zs.push(s.z);
    if (ev) { end = ev; break; }
  }
  return { xs, ys, zs, n: xs.length, end };
}

// ---------- Perencanaan pukulan --------------------------------------
// Lintasan shuttle selalu berada dalam satu bidang vertikal, jadi cukup disimulasi 2D (s = jarak mendatar).
function simPlane(y0, sNet, ang, v) {
  const a = ang * Math.PI / 180;
  let s = 0, y = y0, vh = v * Math.cos(a), vy = v * Math.sin(a), maxH = y0, clear = -9, crossed = false;
  for (let i = 0; i < 700; i++) {
    const k = DRAG * Math.sqrt(vh * vh + vy * vy);
    vh -= k * vh * DT; vy += (-GRAV - k * vy) * DT;
    const ps = s, py = y;
    s += vh * DT; y += vy * DT;
    if (y > maxH) maxH = y;
    if (!crossed && ps < sNet && s >= sNet) { clear = py + (y - py) * (sNet - ps) / (s - ps) - NET_H; crossed = true; }
    if (y <= 0) { const t = py / (py - y); return { s: ps + (s - ps) * t, clear, crossed, maxH }; }
  }
  return { s, clear, crossed, maxH };
}
function solveShot(P, ang, tgt, cap) {
  const dx = tgt.x - P.x, dz = tgt.z - P.z, D = Math.hypot(dx, dz) || 0.01;
  const ux = dx / D, uz = dz / D;
  const sNet = Math.abs(uz) > 0.05 ? Math.abs(P.z) / Math.abs(uz) : 1e9;
  let lo = 3, hi = cap, v;
  if (simPlane(P.y, sNet, ang, hi).s <= D) v = hi;
  else if (simPlane(P.y, sNet, ang, lo).s >= D) v = lo;
  else {
    for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (simPlane(P.y, sNet, ang, m).s < D) lo = m; else hi = m; }
    v = (lo + hi) / 2;
  }
  const r = simPlane(P.y, sNet, ang, v);
  return { v, ux, uz, r, lx: P.x + ux * r.s, lz: P.z + uz * r.s };
}
// angs: sudut (derajat) urut prioritas;  dist: jarak jatuh dari net;  req: jarak aman di atas net
const SHOT = {
  clear:  { angs: [46, 42, 50, 38, 54, 34, 58, 62, 68, 74],           dist: [5.2, 6.3], cap: 62, req: 0.45 },
  drop:   { angs: [20, 12, 28, 4, 36, 44, 52, -6, 60, 68],            dist: [0.6, 1.7], cap: 40, req: 0.3 },
  attack: { angs: [-38, -30, -22, -14, -6, 2, 10, 18, 26, 34, 42],    dist: [2.2, 5.0], cap: 60, req: 0.2 },
  smash:  { angs: [-52, -46, -40, -34, -28, -22, -16, -10, -4, 2],    dist: [2.4, 4.6], cap: 36, req: 0.15 }
};
function shotOk(sol, f, S) {
  const hw = HW();
  return sol.r.crossed && sol.r.clear >= S.req && sol.r.maxH <= 9.5 && Math.abs(sol.uz) > 0.12 &&
    Math.abs(sol.lx) <= hw - 0.05 && f * sol.lz > 0.2 && f * sol.lz <= HL - 0.05;
}
function planShot(P, f, type, tgt, q) {
  const S = SHOT[type];
  let chosen = null;
  for (const ang of S.angs) {
    const sol = solveShot(P, ang, tgt, S.cap);
    if (shotOk(sol, f, S)) { chosen = ang; break; }
  }
  if (chosen === null && type !== 'clear') return planShot(P, f, 'clear', { x: tgt.x, z: f * 5.6 }, q);   // terlalu rendah -> angkat
  if (chosen === null) chosen = 72;
  const eLat = (1 - q) * 2.2 * rand(-1, 1) + 0.15 * rand(-1, 1);
  const eDep = (1 - q) * 1.8 * rand(-1, 1) + 0.2 * rand(-1, 1);
  const t2 = { x: tgt.x + eLat, z: tgt.z + f * eDep };
  const sol = solveShot(P, chosen, t2, S.cap), a = chosen * Math.PI / 180;
  return { type, v: sol.v, vx: sol.v * Math.cos(a) * sol.ux, vz: sol.v * Math.cos(a) * sol.uz, vy: sol.v * Math.sin(a) };
}

// ---------- Pemain ---------------------------------------------------
function rallyHome(p) {
  if (cfg.mode === 1) return { x: 0, z: -p.f * 3.5 };
  return { x: p.slot === 0 ? -1.5 : 1.5, z: -p.f * 3.8 };
}
function buildPlayers() {
  const list = [];
  const mk = (id, team, slot) => ({
    id, team, slot, f: team === 0 ? 1 : -1, human: cfg.humans[id], keys: KEYS[id],
    x: 0, z: 0, h: 0, vx: 0, vz: 0, vy: 0, swingT: -1, cool: 0, anim: 0, style: 'over', hitSwing: false, runT: 0, trail: [], trT: 0,
    speedMul: 0.72 + 0.28 * G.aiLevel, home: { x: 0, z: 0 }, serveHome: { x: 0, z: 0 },
    ai: { errX: 0, errZ: 0, jumpPlan: false, serveTimer: 1 }
  });
  const a = cfg.mode === 2 ? [0, 2] : [0], b = cfg.mode === 2 ? [1, 3] : [1];
  a.forEach((id, i) => list.push(mk(id, 0, i)));
  b.forEach((id, i) => list.push(mk(id, 1, i)));
  return list;
}
function kd(p, k) { const c = p.keys[k]; for (let i = 0; i < c.length; i++) if (keys[c[i]]) return true; return false; }
const fwdHeld = p => kd(p, p.f > 0 ? 'u' : 'd');       // menuju net
const backHeld = p => kd(p, p.f > 0 ? 'd' : 'u');      // menjauhi net
function wantSwing(p) {
  for (const c of p.keys.s) if (edge[c] !== undefined && G.time - edge[c] < 0.15) return true;
  return false;
}
function humanInput(p) {
  return { mx: (kd(p, 'r') ? 1 : 0) - (kd(p, 'l') ? 1 : 0), mz: (kd(p, 'u') ? 1 : 0) - (kd(p, 'd') ? 1 : 0), swing: wantSwing(p) };
}
function inReachPt(p, x, y, z, canJump) {
  const hd = Math.hypot(x - p.x, z - p.z), dy = y - p.h;
  return hd <= REACH && dy >= -0.05 && dy <= REACH_V + (canJump ? 0.8 : 0) && (z - p.z) * p.f > -1.0;
}
function updatePlayer(p, dt) {
  const inp = p.human ? humanInput(p) : aiInput(p, dt);
  let mx = inp.mx, mz = inp.mz;
  const m = Math.hypot(mx, mz);
  if (m > 1) { mx /= m; mz /= m; }
  const sp = PSPEED * (p.human ? 1 : p.speedMul) * (p.swingT >= 0 ? 0.6 : 1);
  p.vx = mx * sp; p.vz = mz * sp;
  // lunge: saat ayunan aktif pemain "menyambar" shuttle yang agak jauh
  const sh = G.shuttle;
  if (p.swingT >= HIT_LO && p.swingT <= HIT_HI && !p.hitSwing && G.state === 'rally' && p.team !== G.lastHitTeam && p.f * sh.z <= 0.2) {
    const dx = sh.x - p.x, dz = sh.z - p.z, hd = Math.hypot(dx, dz);
    if (hd > 0.95 && hd < 3.2) { p.vx += dx / hd * 3.4; p.vz += dz / hd * 3.4; }
  }
  p.x = clamp(p.x + p.vx * dt, -HW() - 1.0, HW() + 1.0);
  p.z = p.team === 0 ? clamp(p.z + p.vz * dt, -7.1, -0.5) : clamp(p.z + p.vz * dt, 0.5, 7.1);
  p.runT += Math.hypot(p.vx, p.vz) * dt * 2.1;
  if (p.h > 0 || p.vy > 0) {
    p.vy -= PGRAV * dt; p.h += p.vy * dt;
    if (p.h <= 0) { p.h = 0; p.vy = 0; }
  }
  // ayunan
  if (p.swingT >= 0) {
    p.swingT += dt;
    p.anim = Math.max(p.anim, Math.min(1, p.swingT / SW_T));
    if (p.swingT >= SW_T) { p.swingT = -1; p.cool = 0.1; p.hitSwing = false; p.anim = 0; }
  } else if (p.cool > 0) p.cool -= dt;
  if (inp.swing && p.swingT < 0 && p.cool <= 0) {
    p.swingT = 0; p.anim = 0; p.hitSwing = false;
    for (const c of p.keys.s) delete edge[c];
    p.style = (G.state === 'rally' && sh.y - p.h < 1.2) ? 'under' : 'over';
    if (G.state === 'rally' && p.team !== G.lastHitTeam && p.h < 0.01 && p.f * sh.z <= 0.2 &&
        sh.y > 2.3 && Math.hypot(sh.x - p.x, sh.z - p.z) < 2.8) { p.vy = JUMP_V; p.h = 0.001; sfxJump(); }   // lompat otomatis untuk bola tinggi
    sfxSwish();
  }
  p.trT += dt;
  if (p.swingT >= 0 && p.trT > 0.012) { p.trT = 0; const r = racketWorld(p); p.trail.push(r.head); if (p.trail.length > 9) p.trail.shift(); }
  else if (p.swingT < 0 && p.trail.length && p.trT > 0.012) { p.trT = 0; p.trail.shift(); }
}

// ---------- CPU ------------------------------------------------------
function aiPickType(p, sh) {
  const zn = Math.abs(sh.z), h = sh.y, d = G.aiLevel, r = Math.random();
  if (h > 2.05 && zn < 4.5) return r < 0.4 + 0.5 * d ? 'attack' : (r < 0.8 ? 'drop' : 'clear');
  if (h < 0.9) return r < 0.65 ? 'clear' : 'drop';
  if (zn > 4) return r < 0.6 ? 'clear' : (r < 0.82 ? 'drop' : 'attack');
  if (zn < 2.2) return r < 0.5 ? 'drop' : (r < 0.75 ? 'clear' : 'attack');
  return r < 0.35 ? 'clear' : (r < 0.65 ? 'drop' : 'attack');
}
function aiTarget(p, type) {
  const S = SHOT[type], hw = HW(), opps = G.players.filter(o => o.team !== p.team);
  const tries = G.aiLevel < 0.5 ? 1 : (G.aiLevel < 0.9 ? 3 : 7);
  let best = null, bestScore = -1;
  for (let i = 0; i < tries; i++) {
    const t = { x: rand(-hw + 0.35, hw - 0.35), z: p.f * lerp(S.dist[0], S.dist[1], Math.random()) };
    let m = 1e9;
    for (const o of opps) m = Math.min(m, Math.hypot(o.x - t.x, o.z - t.z));
    if (m > bestScore) { bestScore = m; best = t; }
  }
  return best;
}
function aiInput(p, dt) {
  const out = { mx: 0, mz: 0, swing: false };
  const L = G.aiLevel, ai = p.ai;
  let tx = p.home.x, tz = p.home.z, speedBoost = 1;
  if (G.state === 'serve') {
    tx = p.serveHome.x; tz = p.serveHome.z;
    if (G.server === p) {
      tx = p.x; tz = p.z;
      ai.serveTimer -= dt;
      if (ai.serveTimer <= 0 && p.swingT < 0 && p.cool <= 0) out.swing = true;
    }
  } else if (G.state === 'rally' && G.pred && G.lastHitTeam !== p.team && G.time - G.lastHitTime >= (1 - L) * 0.35) {
    const pr = G.pred, hw = HW();
    let skip = false;
    if (pr.end === 'ground') {
      const lx = pr.xs[pr.n - 1], lz = pr.zs[pr.n - 1];
      if (Math.abs(lx) > hw + 0.35 || Math.abs(lz) > HL + 0.35) skip = true;     // diprediksi keluar -> biarkan
    }
    let idx = -1, idxJ = -1;
    if (!skip) {
      for (let i = 0; i < pr.n; i++) {
        if (p.f * pr.zs[i] >= 0) continue;
        if (idxJ < 0 && ai.jumpPlan && i > 0 && pr.ys[i] <= 3.3 && pr.ys[i - 1] > 3.3) idxJ = i;
        if (pr.ys[i] <= 1.9) { idx = i; break; }
      }
    }
    if (idx >= 0) {
      let mine = true;
      const hx = pr.xs[idx], hz = pr.zs[idx] - p.f * 0.5;
      for (const q of G.players) {
        if (q === p || q.team !== p.team) continue;
        const dq = Math.hypot(q.x - hx, q.z - hz), dp = Math.hypot(p.x - hx, p.z - hz);
        if (dq < dp - 0.4 || (Math.abs(dq - dp) <= 0.4 && q.slot < p.slot)) mine = false;
      }
      if (mine) {
        const k = idxJ > 0 ? idxJ : idx;
        const hz2 = pr.zs[k] - p.f * 0.5;
        tx = clamp(pr.xs[k] + ai.errX, -hw - 1, hw + 1);
        tz = p.team === 0 ? clamp(hz2 + ai.errZ, -7.1, -0.5) : clamp(hz2 + ai.errZ, 0.5, 7.1);
        speedBoost = 1;
        if (p.swingT < 0 && p.cool <= 0) {
          for (const ts of [0.06, 0.12, 0.18, 0.24]) {
            const kk = Math.round(ts / DT);
            if (kk >= pr.n) continue;
            if (p.f * pr.zs[kk] > 0.2) continue;
            const urgent = kk * DT < 0.3;
            const near = inReachPt(p, pr.xs[kk], pr.ys[kk], pr.zs[kk], ai.jumpPlan || pr.ys[kk] > 2.6);
            const lungeOK = urgent && Math.hypot(pr.xs[kk] - p.x, pr.zs[kk] - p.z) <= REACH + 1.2 &&
                            pr.ys[kk] - p.h >= -0.05 && pr.ys[kk] - p.h <= REACH_V;
            if (near || lungeOK) { out.swing = true; break; }
          }
        }
      }
    }
  }
  const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
  if (d > 0.1) { const k = clamp(d / 0.35, 0, 1) * speedBoost; out.mx = dx / d * k; out.mz = dz / d * k; }
  return out;
}

// ---------- Pukulan --------------------------------------------------
function checkHits() {
  const sh = G.shuttle;
  for (const p of G.players) {
    if (p.swingT < HIT_LO || p.swingT > HIT_HI || p.hitSwing) continue;
    if (G.state === 'serve') { if (p !== G.server) continue; }
    else if (p.team === G.lastHitTeam) continue;
    if (p.f * sh.z > 0.15) continue;                   // shuttle sudah di sisi lawan
    if (inReachPt(p, sh.x, sh.y, sh.z, false)) { doHit(p); break; }
  }
}
function humanTarget(p, type, serving) {
  const hw = HW(), dir = (kd(p, 'r') ? 1 : 0) - (kd(p, 'l') ? 1 : 0);
  let tx = dir !== 0 ? dir * rand(1.1, hw - 0.3) : rand(-0.9, 0.9);
  let range = SHOT[type].dist;
  if (serving) {
    tx = -G.serveSign * rand(0.6, hw - 0.5);          // servis menyilang (diagonal)
    range = type === 'drop' ? [0.9, 1.8] : [4.2, 5.9];
  }
  return { x: tx, z: p.f * lerp(range[0], range[1], rand(0.2, 0.9)) };
}
function doHit(p) {
  const sh = G.shuttle, serving = G.state === 'serve';
  const dzf = (sh.z - p.z) * p.f, hd = Math.hypot(sh.x - p.x, sh.z - p.z);
  let type;
  if (serving) type = p.human ? (fwdHeld(p) ? 'drop' : 'clear') : (Math.random() < 0.65 ? 'clear' : 'drop');
  else if (p.human) type = fwdHeld(p) ? 'attack' : (backHeld(p) ? 'clear' : 'drop');
  else type = aiPickType(p, sh);
  if (type === 'attack' && sh.y >= 2.05) type = 'smash';
  const behind = !serving && dzf < -0.35;
  if (behind) type = 'clear';
  let q = 1 - 0.5 * clamp((hd - 0.9) / 0.9, 0, 1) - (dzf < 0 ? 0.3 * clamp(-dzf / 0.9, 0, 1) : 0);
  if (!p.human) q *= lerp(0.85, 1, G.aiLevel);
  q = serving ? 1 : clamp(q, 0.3, 1);
  let tgt;
  if (p.human || serving) tgt = humanTarget(p, type === 'smash' ? 'smash' : type, serving);
  else tgt = aiTarget(p, type);
  if (!p.human && serving) tgt = humanTarget(p, type, true);
  const plan = planShot({ x: sh.x, y: sh.y, z: sh.z }, p.f, type, tgt, q);
  sh.vx = plan.vx; sh.vy = plan.vy; sh.vz = plan.vz;

  p.style = sh.y - p.h > 1.2 ? 'over' : 'under';
  p.anim = Math.max(p.anim, 0.5);
  G.lastHitTeam = p.team; G.lastHitter = p; G.lastHitTime = G.time; G.lastType = plan.type; p.hitSwing = true;
  G.rally++; G.netFlag = false; G.state = 'rally';
  G.pred = predict();
  for (const o of G.players) if (!o.human) {
    o.ai.errX = rand(-1, 1) * (1 - G.aiLevel) * 0.8; o.ai.errZ = rand(-1, 1) * (1 - G.aiLevel) * 0.6;
    o.ai.jumpPlan = Math.random() < 0.3 + 0.4 * G.aiLevel;
  }
  burst(sh.x, sh.y, sh.z, plan.type === 'smash' ? 22 : 10, TEAMS[p.team].accent);
  if (plan.type === 'smash') { G.shake = 9; popup(sh.x, sh.y + 0.5, sh.z, 'SMASH!', '#ffd84a'); }
  else if (!serving && sh.y < 0.9 && p.human) popup(sh.x, sh.y + 0.5, sh.z, plan.type === 'clear' ? 'ANGKAT!' : 'TANGKIS!', '#9fe8ff');
  sfxHit(plan.type);
}

// ---------- Alur permainan -------------------------------------------
function startMatch() {
  G.aiLevel = LEVELS[cfg.level];
  G.players = buildPlayers();
  G.score = [0, 0]; G.games = [0, 0]; G.gameNo = 1; G.serveTeam = 0; G.serverIdx = [0, 0];
  G.paused = false; G.time = 0; G.msg = null; G.parts = []; G.texts = []; G.trail = [];
  G.matchWinner = -1; G.gameWinner = -1;
  for (const k in edge) delete edge[k];
  startServe();
}
function startServe() {
  G.state = 'serve'; G.lastHitTeam = -1; G.lastHitter = null; G.netFlag = false; G.rally = 0; G.pred = null;
  G.msg = null; G.trail = [];
  const st = G.serveTeam, rt = 1 - st;
  const list = G.players.filter(p => p.team === st);
  G.server = list[G.serverIdx[st] % list.length];
  const rightX = t => (t === 0 ? 1 : -1);                         // sisi kanan tim (dalam koordinat dunia)
  const sx = (G.score[st] % 2 === 0 ? 1 : -1) * rightX(st);        // server berdiri di petak kanan bila skor genap
  G.serveSign = sx;
  for (const p of G.players) {
    p.home = rallyHome(p);
    if (p.team === st) {
      if (p === G.server) p.serveHome = { x: sx * 1.4, z: -p.f * 2.6 };
      else p.serveHome = { x: -sx * 1.5, z: -p.f * 4.7 };
    } else {
      const recv = G.players.filter(q => q.team === rt)[0];
      if (p === recv) p.serveHome = { x: -sx * 1.4, z: -p.f * 3.3 };
      else p.serveHome = { x: sx * 1.5, z: -p.f * 4.8 };
    }
    p.x = p.serveHome.x; p.z = p.serveHome.z; p.h = 0; p.vx = 0; p.vz = 0; p.vy = 0;
    p.swingT = -1; p.cool = 0; p.anim = 0; p.hitSwing = false; p.trail = [];
    p.ai.serveTimer = 0.9 + Math.random() * 0.7; p.ai.errX = 0; p.ai.errZ = 0; p.ai.jumpPlan = false;
  }
  pinShuttle();
  G.shAng = Math.PI / 2;
}
function pinShuttle() {
  const s = G.server, sh = G.shuttle;
  sh.x = s.x + 0.28; sh.y = s.h + 1.05; sh.z = s.z + s.f * 0.55; sh.vx = sh.vy = sh.vz = 0;
}
function gameWinner() {
  const [a, b] = G.score, t = cfg.points, cap = t + 9;
  if ((a >= t && a - b >= 2) || a >= cap) return 0;
  if ((b >= t && b - a >= 2) || b >= cap) return 1;
  return -1;
}
function awardPoint(team, reason) {
  G.score[team]++;
  G.state = 'point'; G.timer = 1.7; G.after = 'serve';
  if (team !== G.serveTeam) { G.serveTeam = team; G.serverIdx[team]++; }
  G.msg = { title: 'Poin ' + TEAMS[team].name + '!', sub: reason, team, t: 0 };
  sfxPoint();
  const w = gameWinner();
  if (w >= 0) {
    G.games[w]++; G.gameWinner = w;
    const need = cfg.games === 3 ? 2 : 1;
    if (G.games[w] >= need) {
      G.matchWinner = w; G.after = 'matchover'; G.timer = 2.0;
      G.msg = { title: TEAMS[w].name + ' Menang!', sub: 'Skor akhir ' + G.score[0] + ' – ' + G.score[1], team: w, t: 0 };
    } else {
      G.after = 'nextgame'; G.timer = 2.6;
      G.msg = { title: 'Gim ' + G.gameNo + ' untuk ' + TEAMS[w].name, sub: G.score[0] + ' – ' + G.score[1], team: w, t: 0 };
    }
  }
}
function afterPoint() {
  if (G.after === 'serve') startServe();
  else if (G.after === 'nextgame') { G.score = [0, 0]; G.gameNo++; G.serveTeam = G.gameWinner; startServe(); }
  else { G.state = 'matchover'; sfxWin(); }
}
function landed(sh) {
  const side = sh.z < 0 ? 0 : 1;
  const inb = Math.abs(sh.x) <= HW() + 0.03 && Math.abs(sh.z) <= HL + 0.03;
  let winner, reason;
  if (inb) {
    winner = 1 - side;
    reason = (G.netFlag && side === G.lastHitTeam) ? 'Tersangkut di net' : 'Shuttle jatuh di area ' + TEAMS[side].name;
  } else {
    winner = 1 - G.lastHitTeam;
    reason = 'OUT! Keluar lapangan';
  }
  burst(sh.x, 0.05, sh.z, 8, '#ffffff');
  awardPoint(winner, reason);
}

// ---------- Langkah simulasi -----------------------------------------
function step(dt) {
  G.time += dt;
  const sh = G.shuttle;
  for (const p of G.players) updatePlayer(p, dt);
  if (G.state === 'serve') pinShuttle();
  if (G.state === 'serve' || G.state === 'rally') checkHits();
  if (G.state === 'rally') {
    const ev = stepShuttle(sh);
    if (ev === 'net') { G.netFlag = true; sfxNet(); burst(sh.x, sh.y, 0, 6, '#ffffff'); }
    else if (ev === 'ground') landed(sh);
    const spd = Math.hypot(sh.vx, sh.vy, sh.vz);
    if (G.state === 'rally' && spd > 8 && (++G.trailTick % 3 === 0)) {
      G.trail.push({ x: sh.x, y: sh.y, z: sh.z });
      if (G.trail.length > 16) G.trail.shift();
    } else if (G.trail.length && G.trailTick % 3 === 0) G.trail.shift();
  }
  if (G.state === 'point') { G.timer -= dt; if (G.timer <= 0) afterPoint(); }
  if (G.msg) G.msg.t += dt;
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const q = G.parts[i]; q.life -= dt;
    if (q.life <= 0) { G.parts.splice(i, 1); continue; }
    q.vy -= 9 * dt; q.x += q.vx * dt; q.y = Math.max(0, q.y + q.vy * dt); q.z += q.vz * dt;
  }
  for (let i = G.texts.length - 1; i >= 0; i--) {
    const q = G.texts[i]; q.life -= dt; q.y += 0.6 * dt;
    if (q.life <= 0) G.texts.splice(i, 1);
  }
  G.shake = Math.max(0, G.shake - 40 * dt);
}
function burst(x, y, z, n, color) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(0.8, 3.5);
    G.parts.push({ x, y, z, vx: Math.cos(a) * s, vy: rand(0.5, 3), vz: Math.sin(a) * s, life: rand(0.25, 0.6), max: 0.6, color });
  }
}
function popup(x, y, z, text, color) { G.texts.push({ x, y, z, text, color, life: 0.9 }); }

// ---------- Suara ----------------------------------------------------
const A = { ctx: null, muted: false };
function ac() {
  if (!A.ctx) { try { A.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { A.ctx = null; } }
  return A.ctx;
}
function beep(f, d, type, v, f2) {
  if (A.muted) return; const c = ac(); if (!c) return;
  try {
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime;
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(v || 0.1, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d + 0.02);
  } catch (e) { /* abaikan */ }
}
function noise(d, v, freq) {
  if (A.muted) return; const c = ac(); if (!c) return;
  try {
    const n = Math.floor(c.sampleRate * d), buf = c.createBuffer(1, n, c.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq || 2500; g.gain.value = v || 0.2;
    src.connect(f); f.connect(g); g.connect(c.destination); src.start();
  } catch (e) { /* abaikan */ }
}
function sfxHit(type) {
  if (type === 'smash') { noise(0.12, 0.5, 1800); beep(520, 0.18, 'square', 0.1, 140); }
  else if (type === 'attack') { noise(0.08, 0.35, 2200); beep(700, 0.1, 'triangle', 0.09, 300); }
  else if (type === 'drop') { noise(0.05, 0.2, 3200); beep(1000, 0.06, 'sine', 0.07, 700); }
  else { noise(0.08, 0.3, 2600); beep(850, 0.1, 'triangle', 0.08, 380); }
}
function sfxSwish() { noise(0.07, 0.07, 1400); }
function sfxJump() { beep(220, 0.08, 'sine', 0.04, 320); }
function sfxNet() { beep(160, 0.12, 'sawtooth', 0.07, 80); }
function sfxPoint() { beep(520, 0.12, 'triangle', 0.1); setTimeout(() => beep(780, 0.2, 'triangle', 0.1), 110); }
function sfxWin() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.25, 'triangle', 0.12), i * 130)); }

// ---------- Raket (geometri 3D) --------------------------------------
const ease = u => Math.pow(clamp(u, 0, 1), 1.5);
function racketPhi(p) {                  // sudut raket di bidang depan-atas: 0 = atas, 90 = ke depan, 180 = bawah
  if (p.swingT >= 0) {
    const u = ease(p.anim);
    return p.style === 'over' ? lerp(-70, 135, u) : lerp(205, 25, u);
  }
  if (p.cool > 0) return lerp(55, p.style === 'over' ? 135 : 25, p.cool / 0.1);
  return 55 + Math.sin(G.time * 3 + p.id) * 4;
}
function racketLocal(p) {
  const a = racketPhi(p) * Math.PI / 180;
  let dx = 0.30, dy = Math.cos(a), dz = Math.sin(a);
  const n = Math.hypot(dx, dy, dz); dx /= n; dy /= n; dz /= n;
  const S = { x: 0.22, y: 1.42, z: 0 };
  const at = t => ({ x: S.x + dx * t, y: S.y + dy * t, z: S.z + dz * t });
  return { S, H: at(0.5), G: at(0.88), Hc: at(1.04), T: at(1.2) };
}
const toWorld = (p, l) => ({ x: p.x + p.f * l.x, y: p.h + l.y, z: p.z + p.f * l.z });
function racketWorld(p) { const r = racketLocal(p); return { head: toWorld(p, r.Hc) }; }

// ---------- Render ---------------------------------------------------
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const bg = document.createElement('canvas');
bg.width = W; bg.height = H;
function buildBG() {
  const b = bg.getContext('2d');
  const poly = (pts, fill, stroke, lw) => {
    b.beginPath();
    pts.forEach((q, i) => { const s = proj(q[0], q[1], q[2]); if (i) b.lineTo(s.x, s.y); else b.moveTo(s.x, s.y); });
    b.closePath();
    if (fill) { b.fillStyle = fill; b.fill(); }
    if (stroke) { b.strokeStyle = stroke; b.lineWidth = lw || 2; b.stroke(); }
  };
  const seg = (a, c, color, lw) => {
    const p1 = proj(a[0], a[1], a[2]), p2 = proj(c[0], c[1], c[2]);
    b.strokeStyle = color; b.lineWidth = lw; b.beginPath(); b.moveTo(p1.x, p1.y); b.lineTo(p2.x, p2.y); b.stroke();
  };
  b.fillStyle = '#0a1128'; b.fillRect(0, 0, W, H);
  // dinding belakang + penonton
  const WZ = 11.5, WH = 7;
  const wb = proj(0, 0, WZ), wt = proj(0, WH, WZ);
  let g = b.createLinearGradient(0, wt.y, 0, wb.y);
  g.addColorStop(0, '#0c1636'); g.addColorStop(1, '#27437f');
  b.fillStyle = g; b.fillRect(0, 0, W, wb.y);
  let seed = 4242; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pal = ['#d9534f', '#f0ad4e', '#5bc0de', '#5cb85c', '#9b59b6', '#ecf0f1', '#e67e22', '#3498db'];
  for (let row = 0; row < 8; row++) {
    const y = 1.35 + row * 0.62;
    for (let x = -24; x < 24; x += 0.5 + rnd() * 0.15) {
      const q = proj(x + rnd() * 0.2, y, WZ), c = pal[Math.floor(rnd() * pal.length)];
      b.globalAlpha = 0.5 + row * 0.04;
      b.fillStyle = c; b.beginPath(); b.ellipse(q.x, q.y + 0.34 * q.s, 0.24 * q.s, 0.3 * q.s, 0, 0, Math.PI * 2); b.fill();
      b.fillStyle = '#e8c39e'; b.beginPath(); b.arc(q.x, q.y, 0.15 * q.s, 0, Math.PI * 2); b.fill();
    }
  }
  b.globalAlpha = 1;
  // lampu langit-langit
  for (let x = -12; x <= 12; x += 6) {
    const q = proj(x, 6.6, WZ), w = 1.3 * q.s;
    b.fillStyle = 'rgba(255,248,214,.9)'; b.fillRect(q.x - w / 2, q.y, w, 6);
    b.fillStyle = 'rgba(255,248,214,.06)'; b.beginPath(); b.moveTo(q.x - w / 2, q.y + 6); b.lineTo(q.x + w / 2, q.y + 6); b.lineTo(q.x + w * 2, wb.y); b.lineTo(q.x - w * 2, wb.y); b.fill();
  }
  // lantai
  g = b.createLinearGradient(0, wb.y, 0, H);
  g.addColorStop(0, '#7b5a38'); g.addColorStop(1, '#4a3320');
  b.fillStyle = g; b.fillRect(0, wb.y, W, H - wb.y);
  for (let x = -40; x <= 40; x += 1.2) seg([x, 0, WZ], [x, 0, -13.5], 'rgba(0,0,0,.10)', 1);
  // papan iklan belakang
  const cols = ['#1d4ed8', '#be123c', '#0f766e', '#a16207'], names = ['BADMINTON', 'ARENA', 'SMASH!', 'RALLY'];
  for (let i = 0, x = -20; x < 20; i++, x += 2.8) {
    poly([[x, 0, 9.6], [x + 2.8, 0, 9.6], [x + 2.8, 0.95, 9.6], [x, 0.95, 9.6]], cols[((i % 4) + 4) % 4]);
    const q = proj(x + 1.4, 0.55, 9.6);
    b.fillStyle = 'rgba(255,255,255,.9)'; b.font = '800 ' + Math.round(0.38 * q.s) + 'px system-ui,sans-serif'; b.textAlign = 'center';
    b.fillText(names[((i % 4) + 4) % 4], q.x, q.y);
  }
  // lapangan
  const hw = 3.05;
  poly([[-4.9, 0, -8.6], [4.9, 0, -8.6], [4.9, 0, 8.6], [-4.9, 0, 8.6]], '#1d5c46');
  poly([[-hw, 0, -HL], [hw, 0, -HL], [hw, 0, HL], [-hw, 0, HL]], '#2e9468');
  b.globalAlpha = 0.07; b.fillStyle = '#fff';
  for (let z = -HL; z < HL; z += 1.34) if (((z + HL) / 1.34 | 0) % 2 === 0) poly([[-hw, 0, z], [hw, 0, z], [hw, 0, z + 1.34], [-hw, 0, z + 1.34]], '#fff');
  b.globalAlpha = 1;
  const L = '#f4f7ff', lw = 3;
  const line = (a, c) => seg(a, c, L, lw);
  line([-hw, 0, -HL], [hw, 0, -HL]); line([-hw, 0, HL], [hw, 0, HL]);
  line([-hw, 0, -HL], [-hw, 0, HL]); line([hw, 0, -HL], [hw, 0, HL]);
  line([-2.59, 0, -HL], [-2.59, 0, HL]); line([2.59, 0, -HL], [2.59, 0, HL]);
  for (const s of [-1, 1]) {
    line([-hw, 0, s * 1.98], [hw, 0, s * 1.98]);                 // garis servis pendek
    line([-hw, 0, s * 5.94], [hw, 0, s * 5.94]);                 // garis servis panjang (ganda)
    line([0, 0, s * 1.98], [0, 0, s * HL]);                      // garis tengah
  }
  // papan iklan samping
  for (const sd of [-1, 1]) {
    for (let i = 0, z = -9.4; z < 9.4; i++, z += 3.1) {
      const x = sd * 5.7;
      poly([[x, 0, z], [x, 0, z + 3.1], [x, 0.9, z + 3.1], [x, 0.9, z]], cols[(i + (sd > 0 ? 1 : 0)) % 4]);
      seg([x, 0.9, z], [x, 0.9, z + 3.1], 'rgba(255,255,255,.55)', 2);
    }
  }
  b.fillStyle = 'rgba(0,0,0,.18)'; b.fillRect(0, wb.y - 2, W, 6);
}
buildBG();

function rr(x, y, w, h, r, fill, stroke) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}
function txt(s, x, y, size, color, align, weight) {
  ctx.font = (weight || 700) + ' ' + size + 'px system-ui,"Segoe UI",sans-serif';
  ctx.textAlign = align || 'center'; ctx.fillStyle = color; ctx.fillText(s, x, y);
}
function groundEllipse(x, z, r, fill, stroke, lw, dash) {
  const c = proj(x, 0, z), a = proj(x + r, 0, z), bb = proj(x, 0, z + r);
  const rx = Math.abs(a.x - c.x), ry = Math.abs(bb.y - c.y);
  ctx.beginPath(); ctx.ellipse(c.x, c.y, rx, Math.max(1, ry), 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; if (dash) ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]); }
}
function drawNet() {
  const hw = 3.05, bandH = 0.76;
  const a = proj(-hw, NET_H, 0), b = proj(hw, NET_H, 0), c = proj(hw, 0, 0), d = proj(-hw, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); ctx.fill();
  const a2 = proj(-hw, NET_H - bandH, 0), b2 = proj(hw, NET_H - bandH, 0);
  ctx.fillStyle = 'rgba(12,18,34,.42)';
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(a2.x, a2.y); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.32)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let x = -hw; x <= hw + 0.001; x += 0.16) { const t = proj(x, NET_H, 0), u = proj(x, NET_H - bandH, 0); ctx.moveTo(t.x, t.y); ctx.lineTo(u.x, u.y); }
  for (let y = NET_H - bandH; y <= NET_H + 0.001; y += 0.076) { const t = proj(-hw, y, 0), u = proj(hw, y, 0); ctx.moveTo(t.x, t.y); ctx.lineTo(u.x, u.y); }
  ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(3, 0.07 * a.s); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.strokeStyle = '#9aa4b8'; ctx.lineWidth = Math.max(3, 0.12 * a.s); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(a.x, a.y - 6); ctx.lineTo(d.x, d.y); ctx.moveTo(b.x, b.y - 6); ctx.lineTo(c.x, c.y); ctx.stroke();
}
function drawPlayer(p) {
  const f = p.f, T = TEAMS[p.team], front = f < 0;
  const L = (x, y, z) => proj(p.x + f * x, p.h + y, p.z + f * (z || 0));
  const g0 = proj(p.x, 0, p.z), S = g0.s;
  const hair = HAIR[p.id % 4], skin = SKIN[(p.id + 1) % 4];
  const moving = Math.hypot(p.vx, p.vz) > 0.3 && p.h < 0.02, sw = moving ? Math.sin(p.runT) : 0, air = p.h > 0.02;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // cincin jangkauan di kaki (pemain manusia)
  const sh = G.shuttle;
  const canHit = G.state === 'rally' && p.team !== G.lastHitTeam && inReachPt(p, sh.x, sh.y, sh.z, true) && p.f * sh.z <= 0.2;
  if (p.human) groundEllipse(p.x, p.z, REACH * 0.85, canHit ? 'rgba(120,255,160,.22)' : 'rgba(255,255,255,.06)',
                             canHit ? 'rgba(150,255,180,.95)' : TEAMS[p.team].accent, 2, canHit ? null : [6, 5]);
  // bayangan
  groundEllipse(p.x, p.z, 0.42 - Math.min(p.h, 1) * 0.12, 'rgba(0,0,0,' + (0.34 - Math.min(p.h, 1) * 0.12) + ')');

  // kaki
  const hip = L(0, 0.9, 0);
  const foot = side => air ? L(side * 0.13, 0.3, 0.12 * side) : L(side * 0.13, Math.max(0, side * sw) * 0.16, side * sw * 0.28);
  ctx.strokeStyle = skin; ctx.lineWidth = 0.1 * S;
  for (const sd of [-1, 1]) {
    const ft = foot(sd), kn = L(sd * 0.12, 0.5, air ? 0.15 : 0.04);
    ctx.beginPath(); ctx.moveTo(hip.x + sd * 0.08 * S, hip.y); ctx.lineTo(kn.x, kn.y); ctx.lineTo(ft.x, ft.y); ctx.stroke();
    ctx.fillStyle = '#f4f4f4'; ctx.beginPath(); ctx.ellipse(ft.x, ft.y, 0.085 * S, 0.05 * S, 0, 0, Math.PI * 2); ctx.fill();
  }
  // celana & badan
  const sho = L(0, 1.42, 0);
  ctx.strokeStyle = T.shorts; ctx.lineWidth = 0.34 * S; ctx.beginPath(); ctx.moveTo(hip.x, hip.y + 0.04 * S); ctx.lineTo(hip.x, hip.y - 0.16 * S); ctx.stroke();
  ctx.strokeStyle = T.shirt; ctx.lineWidth = 0.4 * S; ctx.beginPath(); ctx.moveTo(hip.x, hip.y - 0.12 * S); ctx.lineTo(sho.x, sho.y); ctx.stroke();
  if (!front) {                                          // nomor di punggung (tampak belakang)
    ctx.fillStyle = 'rgba(255,255,255,.88)'; ctx.font = '800 ' + Math.round(0.26 * S) + 'px system-ui,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(String(p.id + 1), sho.x, sho.y + 0.28 * S);
  }
  // lengan non-raket
  const o1 = L(-0.22, 1.42, 0), o2 = L(-0.3, 1.0, 0.1 * f);
  ctx.strokeStyle = skin; ctx.lineWidth = 0.09 * S; ctx.beginPath(); ctx.moveTo(o1.x, o1.y); ctx.lineTo(o2.x, o2.y); ctx.stroke();
  // kepala
  const hd = L(0, 1.67, 0), hr = 0.125 * S;
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(hd.x, hd.y, hr, 0, Math.PI * 2); ctx.fill();
  if (front) {
    ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(hd.x, hd.y - 0.01 * S, hr * 1.02, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = T.band; ctx.fillRect(hd.x - hr, hd.y - hr * 0.35, hr * 2, hr * 0.28);
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(hd.x - hr * 0.38, hd.y + hr * 0.12, hr * 0.12, 0, Math.PI * 2); ctx.arc(hd.x + hr * 0.38, hd.y + hr * 0.12, hr * 0.12, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(hd.x, hd.y - 0.005 * S, hr * 1.04, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = T.band; ctx.fillRect(hd.x - hr, hd.y - hr * 0.1, hr * 2, hr * 0.25);
  }
  // raket
  const r = racketLocal(p);
  const Sh = L(r.S.x, r.S.y, r.S.z), Hh = L(r.H.x, r.H.y, r.H.z), Gp = L(r.G.x, r.G.y, r.G.z), Hc = L(r.Hc.x, r.Hc.y, r.Hc.z), Tp = L(r.T.x, r.T.y, r.T.z);
  if (p.trail.length > 1) {
    for (let i = 1; i < p.trail.length; i++) {
      const a = proj(p.trail[i - 1].x, p.trail[i - 1].y, p.trail[i - 1].z), c = proj(p.trail[i].x, p.trail[i].y, p.trail[i].z);
      ctx.strokeStyle = 'rgba(255,255,255,' + (i / p.trail.length * 0.55) + ')'; ctx.lineWidth = 0.05 * S;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    }
  }
  ctx.strokeStyle = skin; ctx.lineWidth = 0.09 * S; ctx.beginPath(); ctx.moveTo(Sh.x, Sh.y); ctx.lineTo(Hh.x, Hh.y); ctx.stroke();
  ctx.strokeStyle = '#262626'; ctx.lineWidth = Math.max(2, 0.04 * S); ctx.beginPath(); ctx.moveTo(Hh.x, Hh.y); ctx.lineTo(Gp.x, Gp.y); ctx.stroke();
  const ax = Tp.x - Gp.x, ay = Tp.y - Gp.y, len = Math.hypot(ax, ay);
  const cxh = (Hc.x + Gp.x) / 2 + (Tp.x - Hc.x) * 0.0, cyh = (Hc.y + Gp.y) / 2;
  ctx.save();
  ctx.translate((Gp.x + Tp.x) / 2, (Gp.y + Tp.y) / 2); ctx.rotate(Math.atan2(ay, ax));
  const rx = Math.max(len / 2, 0.05 * S), ry = 0.11 * S;
  ctx.fillStyle = 'rgba(255,255,255,.16)'; ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = -0.8; i <= 0.81; i += 0.4) { ctx.moveTo(rx * i, -ry * 0.8); ctx.lineTo(rx * i, ry * 0.8); }
  for (let j = -0.6; j <= 0.61; j += 0.4) { ctx.moveTo(-rx * 0.85, ry * j); ctx.lineTo(rx * 0.85, ry * j); }
  ctx.stroke();
  ctx.strokeStyle = T.accent; ctx.lineWidth = Math.max(2, 0.03 * S); ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  // label
  const lb = L(0, 2.05, 0), label = p.human ? 'P' + (p.id + 1) : 'CPU';
  ctx.font = '800 13px system-ui,sans-serif';
  const w = ctx.measureText(label).width + 14;
  rr(lb.x - w / 2, lb.y - 11, w, 20, 10, T.shirt);
  txt(label, lb.x, lb.y + 4, 13, '#fff', 'center', 800);
}
function drawShuttle() {
  const s = G.shuttle, a = proj(s.x, s.y, s.z);
  if (G.trail.length > 1) {
    for (let i = 1; i < G.trail.length; i++) {
      const t0 = proj(G.trail[i - 1].x, G.trail[i - 1].y, G.trail[i - 1].z), t1 = proj(G.trail[i].x, G.trail[i].y, G.trail[i].z);
      ctx.strokeStyle = 'rgba(255,255,255,' + (i / G.trail.length * 0.45) + ')'; ctx.lineWidth = 1 + i / 5;
      ctx.beginPath(); ctx.moveTo(t0.x, t0.y); ctx.lineTo(t1.x, t1.y); ctx.stroke();
    }
  }
  if (a.y < 14) {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(a.x, 6); ctx.lineTo(a.x - 9, 22); ctx.lineTo(a.x + 9, 22); ctx.closePath(); ctx.fill();
    txt(s.y.toFixed(1) + ' m', a.x, 40, 12, '#fff', 'center', 700);
  }
  const ay = clamp(a.y, 34, H);
  // arah di layar
  let ang = G.shAng;
  const spd = Math.hypot(s.vx, s.vy, s.vz);
  if (spd > 3) {
    const n = proj(s.x + s.vx * 0.03, s.y + s.vy * 0.03, s.z + s.vz * 0.03);
    const target = Math.atan2(n.y - a.y, n.x - a.x);
    let d = target - ang; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    ang += d * 0.45;
  } else {
    let d = Math.PI / 2 - ang; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    ang += d * 0.2;
  }
  G.shAng = ang;
  const k = Math.max(a.s, 30);
  ctx.save();
  ctx.translate(a.x, ay); ctx.rotate(ang);
  const L = 0.34 * k, Wd = 0.12 * k;
  ctx.fillStyle = 'rgba(255,255,255,.96)';
  ctx.beginPath(); ctx.moveTo(-0.04 * k, -0.04 * k); ctx.lineTo(-L, -Wd); ctx.lineTo(-L, Wd); ctx.lineTo(-0.04 * k, 0.04 * k); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(150,160,190,.85)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = -2; i <= 2; i++) { ctx.moveTo(-0.04 * k, i * 0.02 * k); ctx.lineTo(-L, i * Wd * 0.5); }
  ctx.stroke();
  ctx.fillStyle = '#f7e3b0'; ctx.strokeStyle = '#c29a52'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0.02 * k, 0, Math.max(3.5, 0.075 * k), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawShuttleGround() {
  const s = G.shuttle, c = proj(s.x, 0, s.z);
  if (s.y > 0.6) {                                      // garis tinggi ke bayangan: bantu persepsi kedalaman
    const a = proj(s.x, s.y, s.z);
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); ctx.setLineDash([]);
  }
  groundEllipse(s.x, s.z, clamp(0.28 - s.y * 0.012, 0.12, 0.28), 'rgba(0,0,0,' + clamp(0.5 - s.y * 0.03, 0.15, 0.5) + ')');
}
function drawMarker() {
  if (!cfg.marker || G.state !== 'rally' || !G.pred || G.pred.end !== 'ground') return;
  const lx = G.pred.xs[G.pred.n - 1], lz = G.pred.zs[G.pred.n - 1];
  const pulse = 0.55 + 0.3 * Math.sin(G.time * 9);
  const col = Math.abs(lx) > HW() + 0.03 || Math.abs(lz) > HL + 0.03 ? 'rgba(255,120,120,' : 'rgba(255,240,120,';
  groundEllipse(lx, lz, 0.4, col + (pulse * 0.25) + ')', col + pulse + ')', 2.5, [6, 4]);
}
function drawHUD() {
  const cx = W / 2;
  rr(cx - 260, 12, 520, 66, 16, 'rgba(8,14,32,.82)');
  for (let t = 0; t < 2; t++) {
    const left = t === 0, X = left ? cx - 244 : cx + 244, al = left ? 'left' : 'right';
    txt(TEAMS[t].name.toUpperCase() + (t === 0 ? ' · DEKAT' : ' · JAUH'), X, 34, 13, TEAMS[t].accent, al, 800);
    const need = cfg.games === 3 ? 2 : 1;
    if (cfg.games === 3) for (let i = 0; i < need; i++) {
      ctx.fillStyle = i < G.games[t] ? '#ffd84a' : 'rgba(255,255,255,.2)';
      ctx.beginPath(); ctx.arc(left ? X + 6 + i * 16 : X - 6 - i * 16, 52, 5, 0, Math.PI * 2); ctx.fill();
    }
    if (G.serveTeam === t && G.state !== 'matchover') {
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(left ? X + 6 : X - 6, 66, 4, 0, Math.PI * 2); ctx.fill();
      txt('servis', left ? X + 14 : X - 14, 70, 10, '#cfd8f5', al, 600);
    }
    txt(String(G.score[t]), cx + (left ? -62 : 62), 62, 46, '#fff', 'center', 800);
  }
  txt(':', cx, 58, 36, '#7f93cc', 'center', 800);
  txt('Gim ' + G.gameNo + ' · sampai ' + cfg.points + (cfg.games === 3 ? ' · terbaik dari 3' : ''), cx, 96, 12, '#b9c6ee', 'center', 600);
  if (G.rally > 1 && G.state === 'rally') txt('Reli ' + G.rally, cx, 114, 14, '#ffd84a', 'center', 800);
  if (!cfg.touch) txt('P jeda · M suara · Esc menu', 14, H - 12, 12, 'rgba(255,255,255,.75)', 'left', 600);
  if (A.muted) txt('🔇', W - 20, H - 12, 14, '#fff', 'right', 600);
}
function drawBanner() {
  const m = G.msg;
  if (!m) return;
  const a = clamp(m.t * 5, 0, 1), sc = 0.85 + 0.15 * clamp(m.t * 6, 0, 1);
  ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, 285); ctx.scale(sc, sc);
  rr(-330, -52, 660, 112, 22, 'rgba(6,10,24,.84)', TEAMS[m.team].accent);
  txt(m.title, 0, -6, 44, '#fff', 'center', 800);
  txt(m.sub, 0, 36, 20, TEAMS[m.team].accent, 'center', 600);
  ctx.restore();
}
function drawServePrompt() {
  if (G.state !== 'serve' || !G.server) return;
  const s = G.server, lb = proj(s.x, 2.45, s.z);
  if (s.human) {
    const onScreen = touchIds.includes(s.id), k = KEYLBL[s.id];
    rr(lb.x - 170, lb.y - 40, 340, 46, 10, 'rgba(6,10,24,.82)');
    txt('Tekan ' + (onScreen ? 'PUKUL' : '[' + k.hit + ']') + ' untuk servis', lb.x, lb.y - 20, 15, '#fff', 'center', 800);
    txt('tahan arah ke net = servis pendek', lb.x, lb.y - 2, 12, '#b9c6ee', 'center', 600);
  } else txt('CPU bersiap servis…', lb.x, lb.y - 10, 15, '#fff', 'center', 700);
}
function render() {
  ctx.save();
  if (G.shake > 0) ctx.translate(rand(-1, 1) * G.shake, rand(-1, 1) * G.shake);
  ctx.drawImage(bg, 0, 0);
  if (G.state !== 'menu' || G.players.length) {
    drawMarker();
    drawShuttleGround();
    // urutkan dari yang terjauh (z besar) ke terdekat
    const items = G.players.map(p => ({ z: p.z, fn: () => drawPlayer(p) }));
    items.push({ z: 0, fn: drawNet });
    items.push({ z: G.shuttle.z + 0.001, fn: drawShuttle });
    items.sort((a, b) => b.z - a.z);
    for (const it of items) it.fn();
    for (const q of G.parts) {
      const s = proj(q.x, q.y, q.z);
      ctx.globalAlpha = clamp(q.life / q.max, 0, 1); ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(2, 0.05 * s.s), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const q of G.texts) { const s = proj(q.x, q.y, q.z); ctx.globalAlpha = clamp(q.life * 2, 0, 1); txt(q.text, s.x, s.y, 32, q.color, 'center', 900); }
    ctx.globalAlpha = 1;
    drawServePrompt();
    drawHUD();
    drawBanner();
    if (G.state === 'matchover') {
      ctx.fillStyle = 'rgba(4,8,20,.72)'; ctx.fillRect(0, 0, W, H);
      const w = G.matchWinner;
      txt('🏆 ' + TEAMS[w].name + ' Juara!', W / 2, 300, 56, '#fff', 'center', 900);
      txt('Gim ' + G.games[0] + ' – ' + G.games[1] + '  ·  skor terakhir ' + G.score[0] + ' – ' + G.score[1], W / 2, 346, 22, TEAMS[w].accent, 'center', 600);
      txt(cfg.touch ? 'Ketuk layar: main lagi    ·    ☰ : menu' : 'Enter / R: main lagi    ·    Esc: menu', W / 2, 402, 20, '#cfd8f5', 'center', 700);
    }
    if (G.paused) {
      ctx.fillStyle = 'rgba(4,8,20,.65)'; ctx.fillRect(0, 0, W, H);
      txt('JEDA', W / 2, 330, 64, '#fff', 'center', 900);
      txt(cfg.touch ? 'Ketuk layar untuk lanjut' : 'Tekan P untuk lanjut', W / 2, 370, 20, '#cfd8f5', 'center', 600);
    }
  }
  ctx.restore();
}

// ---------- Menu -----------------------------------------------------
const menuEl = document.getElementById('menu');
const cardEl = document.getElementById('card');
const PRESETS = [
  ['1v1 · Lawan CPU', 1, [true, false, false, false]],
  ['1v1 · 2 Pemain', 1, [true, true, false, false]],
  ['2v2 · Kamu + CPU vs CPU', 2, [true, false, false, false]],
  ['2v2 · 2 Pemain + CPU', 2, [true, true, false, false]],
  ['2v2 · 4 Pemain', 2, [true, true, true, true]]
];
function chip(on, act, v, label) {
  return '<button class="chip' + (on ? ' on' : '') + '" data-act="' + act + '" data-v="' + v + '">' + label + '</button>';
}
function slotRow(id) {
  const k = KEYLBL[id];
  return '<div class="slot"><b>P' + (id + 1) + '</b><span class="keys">' + k.move + ' · pukul ' + k.hit + '</span>' +
    chip(cfg.humans[id], 'slot', id, cfg.humans[id] ? 'Manusia' : 'CPU') + '</div>';
}
function renderMenu() {
  const t0 = cfg.mode === 2 ? [0, 2] : [0], t1 = cfg.mode === 2 ? [1, 3] : [1];
  cardEl.innerHTML =
    '<h1>🏸 Badminton Arena 3D</h1><p class="sub">Tampilan dari belakang pemain. Main 1 vs 1 sampai 2 vs 2 — bisa lawan teman di satu keyboard, di HP, atau lawan CPU.</p>' +
    '<h2>Mode cepat</h2><div class="row">' + PRESETS.map((p, i) => chip(false, 'preset', i, p[0])).join('') + '</div>' +
    '<h2>Mode & pemain</h2><div class="row">' + chip(cfg.mode === 1, 'mode', 1, '1 vs 1') + chip(cfg.mode === 2, 'mode', 2, '2 vs 2') + '</div>' +
    '<div class="teams" style="margin-top:10px"><div class="team t0"><h3>Tim Biru (dekat kamera)</h3>' + t0.map(slotRow).join('') +
    '</div><div class="team t1"><h3>Tim Merah (jauh, di atas layar)</h3>' + t1.map(slotRow).join('') + '</div></div>' +
    '<h2>Aturan</h2><div class="row">Poin: ' + [11, 15, 21].map(v => chip(cfg.points === v, 'points', v, v)).join('') +
    '&nbsp; Gim: ' + chip(cfg.games === 1, 'games', 1, '1 gim') + chip(cfg.games === 3, 'games', 3, 'Terbaik dari 3') + '</div>' +
    '<div class="row" style="margin-top:8px">Level CPU: ' + ['Mudah', 'Sedang', 'Sulit'].map((n, i) => chip(cfg.level === i, 'level', i, n)).join('') +
    '&nbsp; Penanda jatuh: ' + chip(cfg.marker, 'marker', 1, cfg.marker ? 'Nyala' : 'Mati') + '</div>' +
    '<div class="row" style="margin-top:8px">Kontrol sentuh (HP): ' + chip(cfg.touch, 'touch', 1, cfg.touch ? 'Nyala' : 'Mati') +
    chip(false, 'full', 1, '⛶ Layar penuh') + '</div>' +
    (cfg.touch ? '<div class="help" style="margin-top:8px"><b>Di HP:</b> pemain manusia pertama memakai tombol layar di kiri, ' +
      'pemain manusia kedua di kanan (2 orang berbagi satu HP). Putar HP ke <b>landscape</b>. ' +
      'Geser jempol di pad arah untuk bergerak; tahan arah lalu tekan <b>PUKUL</b> untuk memilih jenis pukulan.</div>' : '') +
    '<h2>Cara main</h2><div class="help">' +
    '<b>Gerak</b> 4 arah mengikuti layar (atas = menjauhi kamera). <b>Pukul</b>: tekan sedikit sebelum shuttle sampai — kamu cukup berada dekat shuttle (ada cincin hijau di kaki saat shuttle terjangkau). Pemain otomatis melompat untuk bola tinggi dan menyambar bola yang agak jauh.<br>' +
    '<b>Jenis pukulan</b> ditentukan arah yang ditahan saat memukul: <b>maju ke net</b> = serang (bola tinggi jadi <b>smash</b>), <b>mundur dari net</b> = clear/angkat tinggi ke belakang, <b>tanpa arah</b> = drop tipis. <b>Kiri/kanan</b> = arahkan pukulan menyilang. ' +
    'Untuk Tim Merah (di atas layar) "maju ke net" berarti tombol <b>turun</b> (↓ / S-nya masing-masing).<br>' +
    '<b>Menangkis smash:</b> smash datang rendah — dekati titik jatuh (penanda kuning di lantai), lalu pukul tanpa arah (tangkisan/drop) atau tahan mundur (angkat tinggi) untuk memukul dari bawah.<br>' +
    'Servis: tekan tombol pukul (tahan arah ke net = servis pendek). Satu tim tidak boleh memukul dua kali berturut-turut — di ganda, rekan setim berbagi lapangan. Shuttle jatuh di area sendiri, nyangkut di net, atau keluar garis = poin lawan. Satu-keyboard banyak orang: kalau ada tombol tak terbaca, itu keterbatasan keyboard (ghosting).</div>' +
    '<button id="start">▶ Mulai Main</button>';
}
cardEl.addEventListener('click', e => {
  const el = e.target.closest('button'); if (!el) return;
  if (el.id === 'start') { showGame(); return; }
  const act = el.dataset.act, v = +el.dataset.v;
  if (act === 'preset') { cfg.mode = PRESETS[v][1]; cfg.humans = PRESETS[v][2].slice(); }
  else if (act === 'mode') cfg.mode = v;
  else if (act === 'slot') cfg.humans[v] = !cfg.humans[v];
  else if (act === 'points') cfg.points = v;
  else if (act === 'games') cfg.games = v;
  else if (act === 'level') cfg.level = v;
  else if (act === 'marker') cfg.marker = !cfg.marker;
  else if (act === 'touch') cfg.touch = !cfg.touch;
  else if (act === 'full') { toggleFullscreen(); return; }
  renderMenu();
});
function toggleFullscreen() {
  try {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); return; }
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    const r = req.call(el);
    const lock = () => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* tidak didukung */ } };
    if (r && r.then) r.then(lock).catch(() => {}); else lock();
  } catch (e) { /* abaikan */ }
}
function showGame() {
  menuEl.classList.add('hidden'); document.body.classList.add('playing'); ac(); startMatch(); buildTouch();
}
function showMenu() {
  G.state = 'menu'; G.paused = false; releaseTouch(); menuEl.classList.remove('hidden');
  document.body.classList.remove('playing'); buildTouch(); renderMenu();
}
renderMenu();

// ---------- Kontrol sentuh -------------------------------------------
const touchEl = document.getElementById('touch');
const tbarEl = document.getElementById('tbar');
const heldTouch = new Map();           // pointerId -> tombol
let touchIds = [];                     // id pemain (P1..P4) yang dikendalikan lewat layar
const DIRMAP = { ul: ['l', 'u'], u: ['u'], ur: ['r', 'u'], l: ['l'], r: ['r'], dl: ['l', 'd'], d: ['d'], dr: ['r', 'd'], s: ['s'] };
function touchBtn(id, a, label, extra) {
  return '<button class="tb t' + (id % 2) + (extra ? ' ' + extra : '') + '" data-id="' + id + '" data-a="' + a + '">' + label + '</button>';
}
function buildTouch() {
  releaseTouch();
  const hs = G.state === 'menu' ? [] : G.players.filter(p => p.human).slice(0, 2);
  touchIds = cfg.touch ? hs.map(p => p.id) : [];
  const show = cfg.touch && G.state !== 'menu' && hs.length > 0;
  touchEl.style.display = show ? 'block' : 'none';
  tbarEl.style.display = cfg.touch && G.state !== 'menu' ? 'flex' : 'none';
  if (!show) { touchEl.innerHTML = ''; return; }
  const dpad = p => '<div class="dpad">' + touchBtn(p.id, 'ul', '↖', 'dir') + touchBtn(p.id, 'u', '↑', 'dir') + touchBtn(p.id, 'ur', '↗', 'dir') +
    touchBtn(p.id, 'l', '←', 'dir') + '<span></span>' + touchBtn(p.id, 'r', '→', 'dir') +
    touchBtn(p.id, 'dl', '↙', 'dir') + touchBtn(p.id, 'd', '↓', 'dir') + touchBtn(p.id, 'dr', '↘', 'dir') + '</div>';
  const act = p => '<div class="act">' + touchBtn(p.id, 's', '●<small>PUKUL</small>', 'hit') + '</div>';
  if (hs.length === 1) touchEl.innerHTML = '<div class="pad l">' + dpad(hs[0]) + '</div><div class="pad r">' + act(hs[0]) + '</div>';
  else touchEl.innerHTML = '<div class="pad l">' + dpad(hs[0]) + act(hs[0]) + '</div><div class="pad r">' + act(hs[1]) + dpad(hs[1]) + '</div>';
}
// hitung ulang semua tombol yang dikuasai layar sentuh dari daftar jari yang sedang menekan
function syncTouch(newPress) {
  for (const id of touchIds) for (const k of ['l', 'r', 'u', 'd', 's']) for (const c of KEYS[id][k]) keys[c] = false;
  for (const b of heldTouch.values()) {
    const id = +b.dataset.id, a = b.dataset.a;
    for (const k of DIRMAP[a]) for (const c of KEYS[id][k]) keys[c] = true;
  }
  document.querySelectorAll && touchEl.querySelectorAll('.tb').forEach(b => {
    let on = false; for (const v of heldTouch.values()) if (v === b) on = true;
    b.classList.toggle('on', on);
  });
  if (newPress && newPress.dataset.a === 's') for (const c of KEYS[+newPress.dataset.id].s) edge[c] = G.time;
}
function releaseTouch() { heldTouch.clear(); if (touchIds.length) syncTouch(); }
function btnAt(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  return el && el.closest ? el.closest('.tb') : null;
}
touchEl.addEventListener('pointerdown', e => {
  const b = e.target.closest('.tb'); if (!b) return;
  e.preventDefault();
  try { b.releasePointerCapture(e.pointerId); } catch (err) { /* abaikan */ }
  heldTouch.set(e.pointerId, b); syncTouch(b);
});
touchEl.addEventListener('pointermove', e => {
  if (!heldTouch.has(e.pointerId)) return;
  const old = heldTouch.get(e.pointerId);
  if (old.dataset.a === 's') return;
  const b = btnAt(e);
  if (b && b !== old && b.dataset.id === old.dataset.id && b.dataset.a !== 's') { heldTouch.set(e.pointerId, b); syncTouch(); }
});
const touchEnd = e => { if (heldTouch.delete(e.pointerId)) syncTouch(); };
touchEl.addEventListener('pointerup', touchEnd);
touchEl.addEventListener('pointercancel', touchEnd);
touchEl.addEventListener('contextmenu', e => e.preventDefault());
document.getElementById('tb-pause').addEventListener('click', () => { if (G.state !== 'menu') G.paused = !G.paused; });
document.getElementById('tb-menu').addEventListener('click', showMenu);
cv.addEventListener('pointerdown', () => {
  if (G.state === 'matchover') { startMatch(); buildTouch(); }
  else if (G.paused) G.paused = false;
});
document.addEventListener('contextmenu', e => e.preventDefault());

// ---------- Input keyboard -------------------------------------------
window.addEventListener('keydown', e => {
  if (G.state === 'menu') { if (e.code === 'Enter') showGame(); return; }
  if (GAMEKEYS.has(e.code)) e.preventDefault();
  if (!e.repeat) edge[e.code] = G.time;
  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'KeyP') G.paused = !G.paused;
  else if (e.code === 'KeyM') A.muted = !A.muted;
  else if (e.code === 'Escape') showMenu();
  else if ((e.code === 'Enter' || e.code === 'KeyR') && G.state === 'matchover') startMatch();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false; heldTouch.clear();
  if (G.state !== 'menu') G.paused = true;
});

// ---------- Loop utama -----------------------------------------------
let lastT = (typeof performance !== 'undefined' ? performance.now() : 0), acc = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (G.state !== 'menu' && !G.paused) {
    if (G.state === 'rally') G.pred = predict();
    acc += dt;
    while (acc >= DT) { step(DT); acc -= DT; }
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
try {                                   // #demo = CPU lawan CPU tanpa menu (untuk pengujian)
  if (location.hash.indexOf('#demo') === 0) {
    cfg.humans = [/h1/.test(location.hash), /h2/.test(location.hash), false, false]; cfg.touch = /touch/.test(location.hash); cfg.mode = /m2/.test(location.hash) ? 2 : 1; cfg.level = 2; showGame();
    const ff = +((location.hash.match(/ff=([0-9.]+)/) || [])[1] || 0);     // majukan simulasi ff detik (pengujian)
    for (let t = 0; t < ff; t += DT) { if (G.state === 'rally') G.pred = predict(); step(DT); }
  }
} catch (e) { /* bukan browser */ }
