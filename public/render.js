/* IKEA RACE · shared Canvas renderer (host + player). Flat catalog style, no gradients. */
(function () {
  'use strict';
  const TR = window.IKEA_TRACKS;
  const W = TR.WORLD.w, H = TR.WORLD.h;
  const C = { floor: '#F5F5F5', grid: '#ECECEC', track: '#E0E0E0', yellow: '#FFDB00', blue: '#0058A3', ink: '#111111',
    wood: '#D9B98B', birch: '#EAD7B5', card: '#C8A06A', red: '#E4002B', green: '#00A651', white: '#FFFFFF' };
  const TAU = Math.PI * 2;

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function circle(ctx, x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  function fmtTime(ms) {
    if (ms == null) return '—';
    const t = Math.max(0, ms) / 1000, m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }

  /* ---------- track ---------- */
  function strokeSegs(ctx, path, extra, color, dash, colorFn) {
    const { pts, n, closed, cum } = path, m = closed ? n : n - 1;
    ctx.lineJoin = 'round';
    if (dash) { ctx.setLineDash(dash); ctx.lineCap = 'butt'; } else { ctx.setLineDash([]); ctx.lineCap = 'round'; }
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      ctx.strokeStyle = colorFn ? colorFn(cum[i]) : color;
      ctx.lineWidth = (a.w + b.w) / 2 + extra;
      if (dash) ctx.lineDashOffset = cum[i];
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function decoFor(t) {
    if (t._deco) return t._deco;
    const out = [];
    t.zones.forEach(z => {
      for (let k = 0; k < 5; k++) {
        const f = z.a + (z.b - z.a) * (k + 0.5) / 5, pt = TR.pointAt(t.main, f * t.L);
        const nx = -Math.sin(pt.ang), ny = Math.cos(pt.ang);
        for (const side of (k % 2 ? [1, -1] : [-1, 1])) {
          const d = pt.w / 2 + 50, x = pt.x + nx * d * side, y = pt.y + ny * d * side;
          if (x < 30 || y < 30 || x > W - 30 || y > H - 30) continue;
          if (TR.clearance(t, x, y) < 34) continue;
          if (out.some(o => Math.hypot(o.x - x, o.y - y) < 75)) continue;
          out.push({ x, y, kind: z.icon, a: pt.ang });
          break;
        }
      }
    });
    t._deco = out;
    return out;
  }

  function labelSpot(t, f, w, taken) {
    taken = taken || [];
    let best = null;
    for (const df of [0, 0.03, -0.03, 0.06, -0.06]) {
      const pt = TR.pointAt(t.main, (f + df) * t.L), nx = -Math.sin(pt.ang), ny = Math.cos(pt.ang);
      for (const d of [pt.w / 2 + 32, pt.w / 2 + 60, pt.w / 2 + 95]) for (const side of [1, -1]) {
        const x = pt.x + nx * d * side, y = pt.y + ny * d * side;
        let c = Infinity;
        for (const dx of [-w / 2, 0, w / 2]) for (const dy of [-12, 12]) c = Math.min(c, TR.clearance(t, x + dx, y + dy));
        const inside = x - w / 2 > 4 && x + w / 2 < W - 4 && y > 18 && y < H - 18;
        const clash = taken.some(o => Math.abs(o.x - x) < (o.w + w) / 2 + 8 && Math.abs(o.y - y) < 30);
        const score = (inside ? 0 : -1000) + (clash ? -500 : 0) + Math.min(c, 40) - Math.abs(df) * 100;
        if (!best || score > best.score) best = { x, y, score };
      }
    }
    taken.push({ x: best.x, y: best.y, w });
    return best;
  }

  function drawLabel(ctx, x, y, text, size) {
    ctx.font = `900 ${size}px "Noto Sans", Verdana, Arial, sans-serif`;
    const w = ctx.measureText(text).width + size * 0.9;
    ctx.fillStyle = C.yellow; ctx.fillRect(x - w / 2, y - size * 0.75, w, size * 1.5);
    ctx.fillStyle = C.blue; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 1);
  }

  function drawTrack(ctx, t) {
    ctx.fillStyle = C.floor; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let x = 40; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 40; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    // zone floors
    strokeSegs(ctx, t.main, 92, null, null, s => TR.zoneAt(t, s).tint);
    if (t.branch) strokeSegs(ctx, t.branch, 70, '#F2E9D3');
    decoFor(t).forEach(d => drawIcon(ctx, d.kind, d.x, d.y, 1));
    const paths = [t.main, t.branch].filter(Boolean);
    paths.forEach(p => strokeSegs(ctx, p, 7, C.yellow));
    paths.forEach(p => strokeSegs(ctx, p, 8, C.track, [14, 12]));
    paths.forEach(p => strokeSegs(ctx, p, -1, C.track));
    // start / finish line
    const a = t.main.pts[0], b = t.main.pts[1], ang = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(ang);
    const hw = a.w / 2, sq = 6;
    for (let i = 0; i * sq < a.w; i++) for (let j = 0; j < 2; j++) {
      ctx.fillStyle = (i + j) % 2 ? C.blue : C.yellow;
      ctx.fillRect(-sq + j * sq, -hw + i * sq, sq, Math.min(sq, a.w - i * sq));
    }
    ctx.restore();
    const taken = [];
    const fl = labelSpot(t, 0.0, 70, taken);
    drawLabel(ctx, fl.x, fl.y, t.finish, t.finish === 'TACK!' ? 20 : 13);
    // pads
    t.pads.forEach(p => {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang);
      if (p.type === 'ramp') {
        ctx.fillStyle = C.blue; rr(ctx, -p.r, -p.r, p.r * 2, p.r * 2, 3); ctx.fill();
        ctx.fillStyle = C.yellow;
        for (let i = -1; i <= 1; i++) ctx.fillRect(-p.r + 5 + (i + 1) * 9, -p.r + 3, 4, p.r * 2 - 6);
      } else {
        ctx.fillStyle = C.yellow; rr(ctx, -p.r, -p.r * 0.8, p.r * 2, p.r * 1.6, 4); ctx.fill();
        ctx.strokeStyle = C.blue; ctx.lineWidth = 3; ctx.lineCap = 'round';
        for (const dx of [-6, 3]) { ctx.beginPath(); ctx.moveTo(dx - 3, -7); ctx.lineTo(dx + 4, 0); ctx.lineTo(dx - 3, 7); ctx.stroke(); }
      }
      ctx.restore();
    });
    // static obstacles
    t.obstacles.forEach((o, i) => {
      if (o.kind === 'table') {
        for (let k = 0; k < 3; k++) { const an = k * TAU / 3 + i; circle(ctx, o.x + Math.cos(an) * (o.r + 4), o.y + Math.sin(an) * (o.r + 4), 4, C.wood); }
        circle(ctx, o.x, o.y, o.r, C.white); ctx.strokeStyle = '#BDBDBD'; ctx.lineWidth = 2; ctx.stroke();
        circle(ctx, o.x - 4, o.y - 2, 3, C.red); circle(ctx, o.x + 4, o.y + 3, 3, C.yellow);
      } else {
        const cols = [C.red, C.blue, C.yellow, C.green, '#FF7A00'];
        circle(ctx, o.x, o.y, o.r, cols[i % cols.length]);
        circle(ctx, o.x - o.r * 0.35, o.y - o.r * 0.35, o.r * 0.25, 'rgba(255,255,255,.6)');
      }
    });
    // labels
    t.zones.forEach(z => {
      const sp = labelSpot(t, (z.a + z.b) / 2, z.name.length * 11 + 16, taken);
      drawLabel(ctx, sp.x, sp.y, z.name, 16);
    });
    if (t.branch) {
      const mid = TR.pointAt(t.branch, t.branch.L / 2);
      drawLabel(ctx, mid.x, mid.y - 34, 'SCORCIATOIA', 12);
    }
  }

  const cache = new Map();
  function trackCanvas(t, scale) {
    scale = Math.max(0.1, Math.min(2.2, scale));
    const key = t.id + '@' + scale.toFixed(2);
    if (cache.has(key)) return cache.get(key);
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(W * scale); cv.height = Math.ceil(H * scale);
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    drawTrack(ctx, t);
    if (cache.size > 8) cache.delete(cache.keys().next().value);
    cache.set(key, cv);
    return cv;
  }

  /* ---------- decoration icons (flat, readable when tiny) ---------- */
  function drawIcon(ctx, kind, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    switch (kind) {
      case 'sofa':
        ctx.fillStyle = C.blue; rr(ctx, -20, -10, 40, 20, 4); ctx.fill();
        ctx.fillStyle = '#2E7BC4'; rr(ctx, -16, -4, 15, 12, 2); ctx.fill(); rr(ctx, 1, -4, 15, 12, 2); ctx.fill();
        ctx.fillStyle = C.yellow; rr(ctx, -12, -8, 8, 6, 2); ctx.fill(); break;
      case 'kitchen':
        ctx.fillStyle = C.white; ctx.fillRect(-22, -11, 44, 22); ctx.strokeStyle = '#9E9E9E'; ctx.lineWidth = 2; ctx.strokeRect(-22, -11, 44, 22);
        ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
        for (const [cx, cy] of [[-12, -4], [-2, -4], [-12, 5], [-2, 5]]) { ctx.beginPath(); ctx.arc(cx, cy, 3, 0, TAU); ctx.stroke(); }
        ctx.fillStyle = '#9EC9E8'; ctx.fillRect(7, -7, 11, 14); break;
      case 'bed':
        ctx.fillStyle = C.wood; ctx.fillRect(-15, -22, 30, 44);
        ctx.fillStyle = C.white; ctx.fillRect(-12, -18, 24, 38);
        ctx.fillStyle = C.blue; ctx.fillRect(-12, -2, 24, 22);
        ctx.fillStyle = '#E8E8E8'; rr(ctx, -10, -17, 9, 8, 2); ctx.fill(); rr(ctx, 1, -17, 9, 8, 2); ctx.fill(); break;
      case 'lamp':
        circle(ctx, 0, 0, 13, C.yellow); circle(ctx, 0, 0, 6, C.white);
        ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 13, 0, TAU); ctx.stroke(); break;
      case 'shelf':
        ctx.fillStyle = C.birch; ctx.fillRect(-22, -14, 44, 28);
        ctx.strokeStyle = '#A88B5E'; ctx.lineWidth = 2;
        for (let i = -22; i <= 22; i += 11) { ctx.beginPath(); ctx.moveTo(i, -14); ctx.lineTo(i, 14); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(22, 0); ctx.stroke();
        ctx.fillStyle = C.blue; ctx.fillRect(-19, -11, 6, 8); ctx.fillStyle = C.red; ctx.fillRect(4, 3, 6, 8); break;
      case 'pallet':
        ctx.fillStyle = C.wood;
        for (let i = -16; i <= 12; i += 9) ctx.fillRect(i, -16, 6, 32);
        ctx.fillStyle = C.card; ctx.fillRect(-12, -12, 24, 24);
        ctx.fillStyle = '#A07A45'; ctx.fillRect(-2, -12, 4, 24); break;
      case 'box':
        drawBoxShape(ctx, 0, 0, 16); break;
      case 'cart':
        drawCart(ctx, 1.4); break;
      case 'tray':
        ctx.fillStyle = '#9E9E9E'; rr(ctx, -18, -12, 36, 24, 4); ctx.fill();
        circle(ctx, -7, 0, 7, C.white); circle(ctx, -7, 0, 3, '#8D5524');
        circle(ctx, 8, -3, 5, C.white); ctx.fillStyle = C.red; ctx.fillRect(5, 4, 8, 4); break;
      case 'table':
        for (let k = 0; k < 4; k++) circle(ctx, Math.cos(k * TAU / 4) * 15, Math.sin(k * TAU / 4) * 15, 5, C.wood);
        circle(ctx, 0, 0, 11, C.white); ctx.strokeStyle = '#BDBDBD'; ctx.lineWidth = 2; ctx.stroke(); break;
      case 'icecream':
        ctx.fillStyle = C.card; ctx.beginPath(); ctx.moveTo(-8, -2); ctx.lineTo(8, -2); ctx.lineTo(0, 18); ctx.closePath(); ctx.fill();
        circle(ctx, 0, -6, 9, '#FFF3E0'); circle(ctx, 3, -10, 3, C.red); break;
      case 'cup':
        circle(ctx, 0, 0, 12, C.white); ctx.strokeStyle = '#BDBDBD'; ctx.lineWidth = 2; ctx.stroke();
        circle(ctx, 0, 0, 8, '#6D4C41'); ctx.fillStyle = C.white; ctx.fillRect(10, -3, 7, 6); break;
      case 'ball':
        [[-8, -6, C.red], [6, -8, C.blue], [9, 5, C.yellow], [-5, 7, C.green], [0, -1, '#FF7A00']].forEach(([a, b, c]) => circle(ctx, a, b, 6, c)); break;
      case 'toy':
        ctx.fillStyle = C.red; ctx.beginPath(); ctx.moveTo(-16, 12); ctx.lineTo(0, -14); ctx.lineTo(16, 12); ctx.closePath(); ctx.fill();
        ctx.fillStyle = C.yellow; ctx.fillRect(-6, 2, 12, 10); break;
      case 'bear':
        circle(ctx, -8, -9, 5, '#A1887F'); circle(ctx, 8, -9, 5, '#A1887F'); circle(ctx, 0, 0, 12, '#A1887F');
        circle(ctx, -4, -2, 2, C.ink); circle(ctx, 4, -2, 2, C.ink); circle(ctx, 0, 4, 3, '#D7CCC8'); break;
      case 'register':
        ctx.fillStyle = '#BDBDBD'; ctx.fillRect(-22, -10, 44, 20);
        ctx.fillStyle = C.ink; ctx.fillRect(-14, -6, 4, 12); ctx.fillRect(-8, -6, 2, 12); ctx.fillRect(-4, -6, 5, 12);
        ctx.fillStyle = C.blue; ctx.fillRect(6, -7, 12, 14); ctx.fillStyle = C.yellow; ctx.fillRect(9, -4, 6, 4); break;
      case 'plant':
        ctx.fillStyle = C.green;
        for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.ellipse(Math.cos(k) * 7, Math.sin(k) * 7, 9, 4, k, 0, TAU); ctx.fill(); }
        circle(ctx, 0, 0, 6, C.white); break;
    }
    ctx.restore();
  }

  function drawBoxShape(ctx, x, y, s) {
    ctx.fillStyle = C.card; ctx.fillRect(x - s, y - s, s * 2, s * 2);
    ctx.fillStyle = '#A07A45'; ctx.fillRect(x - s * 0.15, y - s, s * 0.3, s * 2);
    ctx.strokeStyle = '#8A6634'; ctx.lineWidth = 1.5; ctx.strokeRect(x - s, y - s, s * 2, s * 2);
  }
  function drawCart(ctx, s) {
    ctx.save(); ctx.scale(s, s);
    ctx.strokeStyle = '#616161'; ctx.lineWidth = 2;
    ctx.strokeRect(-9, -6, 16, 12);
    for (let i = -5; i <= 3; i += 4) { ctx.beginPath(); ctx.moveTo(i, -6); ctx.lineTo(i, 6); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(-13, -8); ctx.stroke();
    circle(ctx, -6, 8, 2, C.ink); circle(ctx, 5, 8, 2, C.ink);
    ctx.fillStyle = C.blue; ctx.fillRect(-7, -4, 5, 4); ctx.fillStyle = C.yellow; ctx.fillRect(0, -3, 5, 5);
    ctx.restore();
  }

  /* ---------- cars ---------- */
  function drawCar(ctx, x, y, h, color, o) {
    o = o || {};
    ctx.save(); ctx.translate(x, y);
    const s = (o.scale || 1) * (o.jump ? 1.35 : 1);
    if (o.jump) { ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.beginPath(); ctx.ellipse(5, 8, 13, 8, h, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    if (o.invi) circle(ctx, 0, 0, 17 * s, Math.floor((o.t || 0) / 90) % 2 ? C.yellow : C.red);
    if (o.me) { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 17 * s, 0, TAU); ctx.stroke(); }
    ctx.rotate(h); ctx.scale(s, s);
    ctx.fillStyle = '#222';
    for (const [wx, wy] of [[-9, -8], [5, -8], [-9, 6], [5, 6]]) ctx.fillRect(wx, wy, 5, 2.2);
    ctx.fillStyle = color; rr(ctx, -12, -6.5, 24, 13, 3.5); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.9)'; rr(ctx, 1.5, -5, 5, 10, 1.5); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-10, -4.5, 3, 9);
    ctx.fillStyle = color.toUpperCase() === '#FFDB00' ? C.blue : C.yellow; ctx.fillRect(-6, -1.2, 6, 2.4);
    ctx.restore();
  }

  /* ---------- items ---------- */
  function drawItem(ctx, type, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const ball = (bx, by, r, c) => { circle(ctx, bx, by, r, c); circle(ctx, bx - r * 0.35, by - r * 0.35, r * 0.3, 'rgba(255,255,255,.45)'); };
    switch (type) {
      case 'KOTTBULLAR_1': ball(0, 0, 7, '#8D5524'); break;
      case 'KOTTBULLAR_3': ball(-5, 3, 5.5, '#8D5524'); ball(5, 3, 5.5, '#8D5524'); ball(0, -5, 5.5, '#8D5524'); break;
      case 'KOTTBULLAR_GOLD':
        ball(0, 0, 8, '#F2B705');
        ctx.fillStyle = C.white; for (const [a, b] of [[-9, -8], [9, -6], [7, 9]]) { ctx.fillRect(a - 1, b - 3, 2, 6); ctx.fillRect(a - 3, b - 1, 6, 2); }
        break;
      case 'PILLOW_GREEN': case 'PILLOW_RED':
        ctx.fillStyle = type === 'PILLOW_GREEN' ? C.green : C.red; rr(ctx, -8, -7, 16, 14, 5); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.stroke();
        if (type === 'PILLOW_RED') { ctx.fillStyle = C.white; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, TAU); ctx.fill(); }
        break;
      case 'MASH_POTATO':
        circle(ctx, -4, 2, 6, '#FFF1C1'); circle(ctx, 4, 2, 6, '#FFF1C1'); circle(ctx, 0, -3, 6, '#FFF1C1');
        circle(ctx, 0, 0, 3, '#8D5524'); break;
      case 'HOTDOG':
        ctx.fillStyle = '#E0A458'; rr(ctx, -10, -5, 20, 10, 5); ctx.fill();
        ctx.fillStyle = '#B5432F'; rr(ctx, -12, -2.5, 24, 5, 2.5); ctx.fill();
        ctx.strokeStyle = C.yellow; ctx.lineWidth = 1.5; ctx.beginPath();
        for (let i = -8; i <= 8; i += 4) ctx.lineTo(i, i % 8 ? -1 : 1); ctx.stroke(); break;
      case 'CART':
        ctx.fillStyle = '#FF7A00'; ctx.beginPath(); ctx.moveTo(-10, -4); ctx.lineTo(-17, 0); ctx.lineTo(-10, 4); ctx.fill();
        drawCart(ctx, 0.9); break;
      case 'FRAKTA_BAG':
        ctx.fillStyle = C.blue; ctx.beginPath(); ctx.moveTo(-9, -4); ctx.lineTo(9, -4); ctx.lineTo(7, 9); ctx.lineTo(-7, 9); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = C.yellow; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-5, -4); ctx.lineTo(-3, -10); ctx.lineTo(3, -10); ctx.lineTo(5, -4); ctx.stroke(); break;
      case 'SWEDISH_FLAG':
        ctx.fillStyle = '#006AA7'; ctx.fillRect(-10, -7, 20, 14);
        ctx.fillStyle = '#FECC00'; ctx.fillRect(-5, -7, 3, 14); ctx.fillRect(-10, -1.5, 20, 3); break;
      case 'DAJLIEN_BOX': drawBoxShape(ctx, 0, 0, 8); break;
    }
    ctx.restore();
  }
  function drawItemBox(ctx, x, y, t) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t / 400) * 0.25);
    const s = 1 + Math.sin(t / 250) * 0.06; ctx.scale(s, s);
    ctx.fillStyle = C.blue; rr(ctx, -9, -9, 18, 18, 3); ctx.fill();
    ctx.fillStyle = C.yellow; ctx.font = '900 14px Verdana, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 1);
    ctx.restore();
  }
  function drawTrap(ctx, x, y, type) {
    if (type === 'mash') { drawItem(ctx, 'MASH_POTATO', x, y, 1.2); }
    else { ctx.save(); drawBoxShape(ctx, x, y, 11); ctx.restore(); }
  }
  function drawProjectile(ctx, x, y, type, h, t) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(t / 90);
    drawItem(ctx, type === 'red' ? 'PILLOW_RED' : 'PILLOW_GREEN', 0, 0, 1);
    ctx.restore();
  }

  /* ---------- random events ---------- */
  function drawEvent(ctx, e, t) {
    ctx.save(); ctx.translate(e.x, e.y);
    switch (e.k) {
      case 'forklift':
        ctx.rotate(e.a);
        ctx.fillStyle = '#9E9E9E'; ctx.fillRect(14, -9, 14, 3); ctx.fillRect(14, 6, 14, 3);
        ctx.fillStyle = '#FF7A00'; rr(ctx, -18, -13, 32, 26, 3); ctx.fill();
        ctx.fillStyle = C.ink; ctx.fillRect(-8, -9, 14, 18);
        ctx.fillStyle = C.yellow; ctx.fillRect(-16, -11, 5, 22);
        if (Math.floor(t / 200) % 2) circle(ctx, -2, 0, 3, C.yellow);
        break;
      case 'shelf': {
        ctx.rotate(e.a);
        const len = e.len || 30;
        if (e.w) {
          ctx.strokeStyle = Math.floor(t / 150) % 2 ? C.red : C.yellow; ctx.lineWidth = 3; ctx.setLineDash([6, 5]);
          ctx.strokeRect(-12, -len / 2 - 4, 24, len + 8); ctx.setLineDash([]);
          ctx.fillStyle = C.red; ctx.font = '900 18px Verdana, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', 0, 0);
        } else {
          ctx.fillStyle = C.birch; ctx.fillRect(-11, -len / 2 - 4, 22, len + 8);
          ctx.strokeStyle = '#A88B5E'; ctx.lineWidth = 2;
          for (let i = -len / 2; i <= len / 2; i += len / 3) { ctx.beginPath(); ctx.moveTo(-11, i); ctx.lineTo(11, i); ctx.stroke(); }
          drawBoxShape(ctx, -3, -len / 4, 5); drawBoxShape(ctx, 4, len / 4, 4);
        }
        break;
      }
      case 'cart':
        ctx.rotate(e.a + Math.sin(t / 60) * 0.15); drawCart(ctx, 1.5); break;
      case 'cleaning':
        ctx.rotate(e.a);
        ctx.fillStyle = C.yellow; ctx.beginPath(); ctx.moveTo(-20, -6); ctx.lineTo(-12, 6); ctx.lineTo(-28, 6); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#9E9E9E'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(14, Math.sin(t / 120) * 8); ctx.stroke();
        ctx.fillStyle = '#B3E5FC'; ctx.fillRect(12, Math.sin(t / 120) * 8 - 6, 4, 12);
        circle(ctx, 0, 0, 8, C.blue); circle(ctx, 0, 0, 4, '#F1C27D');
        break;
      case 'icecream': {
        const bob = Math.sin(t / 120) * 4;
        ctx.translate(0, -30 + bob);
        drawIcon(ctx, 'icecream', 0, 0, 1.1);
        ctx.fillStyle = C.ink; ctx.font = '900 11px Verdana, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('CATCH!', 0, -18);
        break;
      }
    }
    ctx.restore();
  }

  /* ---------- particles ---------- */
  class Particles {
    constructor() { this.a = []; }
    emit(x, y, o) {
      o = o || {};
      const n = o.n || 8;
      for (let i = 0; i < n && this.a.length < 900; i++) {
        const an = o.dir != null ? o.dir + (Math.random() - 0.5) * (o.spread || 0.8) : Math.random() * TAU;
        const sp = (o.speed || 60) * (0.4 + Math.random() * 0.8);
        const colors = o.colors || [o.color || C.yellow];
        const life = (o.life || 0.6) * (0.6 + Math.random() * 0.6);
        this.a.push({ x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, life, max: life,
          c: colors[Math.floor(Math.random() * colors.length)], s: (o.size || 3) * (0.6 + Math.random() * 0.8), sq: !!o.square, g: o.gravity || 0 });
      }
    }
    update(dt) {
      for (const p of this.a) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.vx *= 0.96; p.vy *= 0.96; }
      this.a = this.a.filter(p => p.life > 0);
    }
    draw(ctx) {
      for (const p of this.a) {
        ctx.globalAlpha = Math.max(0, p.life / p.max);
        ctx.fillStyle = p.c;
        if (p.sq) ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.s / 2, 0, TAU); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
  }

  // per-frame trail particles from a car's status flags
  function carTrail(parts, c, flags, dt) {
    const back = c.h + Math.PI, bx = c.x - Math.cos(c.h) * 12, by = c.y - Math.sin(c.h) * 12;
    if (flags & 2) parts.emit(bx, by, { n: 3, colors: ['#F2B705', '#FFDB00', '#FFFFFF'], dir: back, spread: 1.2, speed: 70, life: 0.7, size: 4, square: true });
    else if (flags & 512) parts.emit(bx, by, { n: 2, colors: ['#8D5524', '#A0522D'], dir: back, spread: 0.4, speed: 40, life: 0.9, size: 5 });
    else if (flags & 1) parts.emit(bx, by, { n: 2, colors: ['#FF7A00', '#FFDB00'], dir: back, spread: 0.6, speed: 60, life: 0.35, size: 3.5 });
    if (flags & 16) parts.emit(c.x, c.y, { n: 1, colors: ['#FFDB00', '#E4002B'], speed: 60, life: 0.4, size: 3, square: true });
    if ((flags & 128) && Math.random() < 0.3) parts.emit(bx, by, { n: 1, color: '#BDBDBD', speed: 20, life: 0.5, size: 3 });
  }

  // smooth display positions toward the latest server snapshot
  function lerpCars(disp, snapPlayers, dt) {
    const k = 1 - Math.exp(-dt * 18);
    for (const p of snapPlayers) {
      let d = disp[p.i];
      if (!d) { d = disp[p.i] = { x: p.x, y: p.y, h: p.h }; continue; }
      if (Math.hypot(p.x - d.x, p.y - d.y) > 80) { d.x = p.x; d.y = p.y; d.h = p.h; continue; }   // teleport (cart rocket)
      d.x += (p.x - d.x) * k; d.y += (p.y - d.y) * k;
      d.h += Math.atan2(Math.sin(p.h - d.h), Math.cos(p.h - d.h)) * k;
    }
  }

  // draws everything dynamic in world space
  function drawDynamic(ctx, st, disp, cars, opt) {
    const t = opt.t;
    st.b.forEach(b => drawItemBox(ctx, b[0], b[1], t + b[0]));
    st.tr.forEach(x => drawTrap(ctx, x[0], x[1], x[2]));
    st.d.forEach(x => {   // incoming sabotage throws
      const k = Math.max(0, Math.min(1, x[3] / 700));
      ctx.strokeStyle = C.red; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(x[0], x[1], 10 + 26 * k, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      const item = x[2] === 'mash' ? 'MASH_POTATO' : x[2] === 'box' ? 'DAJLIEN_BOX' : 'PILLOW_RED';
      drawItem(ctx, item, x[0], x[1] - 120 * k, 1 + k);
    });
    st.e.forEach(e => { if (e.k !== 'icecream' && e.k !== 'blackout') drawEvent(ctx, e, t); });
    st.q.forEach(q => drawProjectile(ctx, q[0], q[1], q[2], q[3], t));
    const list = st.p.filter(p => !p.fin).sort((a, b) => (a.f & 64) - (b.f & 64));
    for (const p of list) {
      const d = disp[p.i], info = cars[p.i];
      if (!d || !info) continue;
      const ghost = p.f & 32, isMe = opt.me === p.i;
      if (ghost && !isMe && !opt.host) continue;              // FRAKTA: invisible to other players
      drawCar(ctx, d.x, d.y, d.h, info.color, { alpha: ghost ? (isMe ? 0.4 : 0.22) : 1, invi: p.f & 16, jump: p.f & 64, t, me: isMe });
      if (opt.names) {
        ctx.font = '800 11px Verdana, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const w = ctx.measureText(info.name).width + 8;
        ctx.fillStyle = 'rgba(17,17,17,.75)'; ctx.fillRect(d.x - w / 2, d.y - 30, w, 14);
        ctx.fillStyle = C.white; ctx.fillText(info.name, d.x, d.y - 23);
      }
    }
    st.e.forEach(e => { if (e.k === 'icecream') { const d = disp[e.tg]; if (d) drawEvent(ctx, { k: 'icecream', x: d.x, y: d.y }, t); } });
  }

  window.IKEA_RENDER = { C, rr, circle, fmtTime, trackCanvas, drawTrack, drawCar, drawItem, drawItemBox, drawIcon,
    drawTrap, drawProjectile, drawEvent, drawLabel, drawBoxShape, Particles, carTrail, lerpCars, drawDynamic };
})();

/* =====================================================================
 * IKEA RACE · 3D store scene (three.js). World (x, y) → three (x, height, z = y).
 * One scene builder shared by the phone (chase camera) and the host (overview).
 * Furniture, walls and racks are batched into a few InstancedMeshes → fast on phones.
 * ===================================================================== */
(function () {
  'use strict';
  if (!window.THREE) return;
  const T3 = window.THREE, TR = window.IKEA_TRACKS, R = window.IKEA_RENDER;
  const W = TR.WORLD.w, H = TR.WORLD.h, TAU = Math.PI * 2;
  const CEIL = 240;
  const col = c => new T3.Color(c);

  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T3.CanvasTexture(c);
    t.colorSpace = T3.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = T3.RepeatWrapping; }
    t.anisotropy = 4;
    return t;
  }

  /* ---------- instanced primitive batches ---------- */
  class Batch {
    constructor() { this.box = []; this.cyl = []; this.sph = []; this.glow = []; }
    // x,z = ground position, y0 = bottom height, sx/sy/sz = size, rot = yaw
    b(x, z, y0, sx, sy, sz, rot, color) { this.box.push([x, y0 + sy / 2, z, sx, sy, sz, rot || 0, color]); }
    c(x, z, y0, r, h, color) { this.cyl.push([x, y0 + h / 2, z, r * 2, h, r * 2, 0, color]); }
    s(x, z, y, r, color, sy) { this.sph.push([x, y, z, r * 2, (sy || r) * 2, r * 2, 0, color]); }
    g(x, z, y0, sx, sy, sz, rot) { this.glow.push([x, y0 + sy / 2, z, sx, sy, sz, rot || 0, '#FFFFFF']); }
    build(group) {
      const mat = new T3.MeshLambertMaterial({ color: 0xffffff });
      const glowMat = new T3.MeshBasicMaterial({ color: 0xffffff });
      const sets = [
        [this.box, new T3.BoxGeometry(1, 1, 1), mat], [this.cyl, new T3.CylinderGeometry(0.5, 0.5, 1, 12), mat],
        [this.sph, new T3.SphereGeometry(0.5, 12, 8), mat], [this.glow, new T3.BoxGeometry(1, 1, 1), glowMat]
      ];
      const dummy = new T3.Object3D();
      for (const [list, geo, m] of sets) {
        if (!list.length) continue;
        const mesh = new T3.InstancedMesh(geo, m, list.length);
        list.forEach((it, i) => {
          dummy.position.set(it[0], it[1], it[2]); dummy.rotation.set(0, it[6], 0); dummy.scale.set(it[3], it[4], it[5]);
          dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, col(it[7]));
        });
        mesh.instanceMatrix.needsUpdate = true;
        group.add(mesh);
      }
    }
  }
  // local helper: place a box in an object's frame (rotation r around x,z)
  function L(B, x, z, r) {
    const c = Math.cos(r), s = Math.sin(r);
    const P = (dx, dz) => [x + dx * c - dz * s, z + dx * s + dz * c];
    return {
      b(dx, dz, y0, sx, sy, sz, color) { const [px, pz] = P(dx, dz); B.b(px, pz, y0, sx, sy, sz, -r, color); },
      c(dx, dz, y0, rad, h, color) { const [px, pz] = P(dx, dz); B.c(px, pz, y0, rad, h, color); },
      s(dx, dz, y, rad, color, sy) { const [px, pz] = P(dx, dz); B.s(px, pz, y, rad, color, sy); }
    };
  }

  /* ---------- furniture (flat IKEA catalog colours, all primitives) ---------- */
  const BIRCH = '#E3CBA0', WOOD = '#B98B57', WHITE = '#F7F7F5', GREY = '#9E9E9E', DARK = '#3A3A3A', CARD = '#C49A62';
  const FABRIC = ['#0058A3', '#4A6C8C', '#8C9A6E', '#C25B3F', '#D9D0C1', '#5E6B73', '#E0B44A'];
  const pick = (arr, i) => arr[Math.abs(i) % arr.length];
  const FURN = {
    sofa(o, i) {
      const f = pick(FABRIC, i);
      o.b(0, 0, 0, 90, 4, 70, pick(['#E8DCC8', '#C9D6DF', '#E6D3D3'], i));          // rug
      o.b(0, -10, 4, 70, 14, 30, f); o.b(0, -22, 4, 70, 26, 8, f);
      o.b(-34, -10, 4, 6, 20, 30, f); o.b(34, -10, 4, 6, 20, 30, f);
      o.b(-14, -12, 18, 18, 6, 14, '#FFDB00'); o.b(0, 18, 4, 34, 12, 18, WOOD);          // cushion + coffee table
    },
    rug(o, i) { o.b(0, 0, 0, 80, 3, 60, pick(['#C25B3F', '#2E5E8C', '#E0B44A', '#8C9A6E'], i)); o.b(0, 0, 3, 50, 1, 30, WHITE); },
    lamp(o, i) {
      o.c(0, 0, 0, 7, 3, DARK); o.c(0, 0, 3, 1.5, 44, DARK);
      o.c(0, 0, 44, 11, 12, pick(['#FFFFFF', '#FFE9A8', '#F4C27A'], i));
      o.c(22, 8, 0, 6, 3, DARK); o.c(22, 8, 3, 1.5, 30, DARK); o.s(22, 8, 36, 8, '#FFF3C4');
    },
    shelf(o, i) {
      const c = pick([WHITE, BIRCH, '#2B2B2B'], i);
      o.b(0, 0, 0, 64, 64, 18, c);
      const cols = ['#0058A3', '#E4002B', '#FFDB00', CARD, '#00A651', WHITE];
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) if ((r + k + i) % 3) o.b(-24 + k * 16, 10, 3 + r * 16, 10, 9, 4, pick(cols, r * 4 + k + i));
    },
    wardrobe(o, i) {
      const c = pick([WHITE, BIRCH, '#5D4037'], i);
      o.b(0, 0, 0, 70, 90, 26, c); o.b(-17, 14, 6, 32, 78, 1, '#DADADA'); o.b(17, 14, 6, 32, 78, 1, '#DADADA');
    },
    bed(o, i) {
      o.b(0, 0, 0, 64, 12, 90, WOOD); o.b(0, 4, 12, 58, 8, 80, WHITE);
      o.b(0, 18, 20, 58, 3, 46, pick(FABRIC, i)); o.b(-14, -30, 20, 22, 6, 14, WHITE); o.b(14, -30, 20, 22, 6, 14, WHITE);
      o.b(0, -46, 0, 64, 34, 6, WOOD); o.b(44, -36, 0, 18, 22, 18, BIRCH); o.c(44, -36, 22, 5, 12, '#FFE9A8');
    },
    kitchen(o, i) {
      const front = pick([WHITE, '#3F5E4E', '#2E4E6E', '#E8E0D0'], i);
      o.b(0, 0, 0, 110, 36, 26, front); o.b(0, 0, 36, 112, 3, 28, BIRCH);
      o.b(0, -6, 62, 110, 30, 14, front); o.b(-30, 2, 39, 22, 2, 16, GREY);
      o.c(30, 2, 39, 5, 3, DARK); o.c(42, 2, 39, 5, 3, DARK);
    },
    table(o, i) {
      o.c(0, 0, 0, 3, 28, DARK); o.c(0, 0, 28, 22, 3, pick([WHITE, BIRCH, WOOD], i));
      for (let k = 0; k < 4; k++) { const a = k * TAU / 4 + 0.4; o.b(Math.cos(a) * 32, Math.sin(a) * 32, 0, 12, 18, 12, pick(['#E4002B', '#0058A3', WOOD, '#FFDB00'], i + k)); }
    },
    plant(o, i) {
      o.c(0, 0, 0, 10, 16, pick([WHITE, '#C25B3F', DARK], i));
      o.s(0, 0, 32, 18, '#3D8B4A', 22); o.s(8, 5, 46, 11, '#4FA35B');
    },
    pallet(o, i) {
      o.b(0, 0, 0, 60, 7, 50, WOOD);
      const n = 2 + (i % 3);
      for (let k = 0; k < n; k++) o.b(-14 + (k % 2) * 28, -12 + Math.floor(k / 2) * 24, 7, 26, 20 + (k * 7 % 10), 22, CARD);
    },
    box(o, i) { o.b(0, 0, 0, 30, 24, 30, CARD); o.b(0, 0, 24, 24, 18, 22, CARD); o.b(0, 0, 42, 4, 0.5, 22, '#8A6634'); },
    cart(o, i) {
      o.b(0, 0, 8, 46, 26, 28, '#B0B0B0'); o.b(0, 0, 10, 40, 24, 24, '#0058A3');
      o.b(-26, 0, 30, 4, 4, 26, DARK); for (const [dx, dz] of [[-18, -11], [18, -11], [-18, 11], [18, 11]]) o.c(dx, dz, 0, 3, 8, DARK);
      o.b(4, 0, 20, 18, 14, 16, '#FFDB00');
    },
    register(o, i) {
      o.b(0, 0, 0, 120, 30, 36, '#D0D0D0'); o.b(0, 0, 30, 120, 2, 36, DARK);
      o.b(46, 0, 32, 16, 18, 14, DARK); o.b(-60, 0, 0, 6, 70, 6, GREY); o.b(-60, 0, 70, 6, 14, 30, '#0058A3');
      o.b(-60, 0, 74, 2, 6, 20, '#FFDB00');
    },
    counter(o, i) { o.b(0, 0, 0, 120, 30, 30, pick([WOOD, WHITE], i)); o.b(0, 0, 30, 124, 4, 34, GREY); o.b(-30, 0, 34, 20, 10, 16, '#C25B3F'); o.b(10, 0, 34, 24, 8, 16, '#FFE9A8'); },
    icecream(o, i) {
      o.b(0, 0, 0, 50, 36, 30, '#F48FB1'); o.c(0, 0, 36, 4, 50, GREY); o.c(0, 0, 80, 32, 4, '#FFFFFF');
      o.c(-10, 0, 36, 4, 10, CARD); o.s(-10, 0, 50, 7, '#FFF3E0'); o.s(-10, 0, 58, 5, '#E4002B');
    },
    balls(o, i) {
      o.b(0, 0, 0, 90, 14, 90, '#0058A3'); o.b(0, 0, 0, 80, 16, 80, '#FFDB00');
      const cs = ['#E4002B', '#0058A3', '#FFDB00', '#00A651', '#FF7A00'];
      for (let k = 0; k < 14; k++) o.s(-30 + (k * 37 % 60), -30 + (k * 53 % 60), 18, 7, pick(cs, k + i));
    },
    toy(o, i) {
      o.b(0, 0, 0, 22, 50, 22, '#E4002B'); o.b(0, 0, 50, 26, 4, 26, '#FFDB00');
      const s = new T3.Object3D(); // slide (tilted box approximated by steps)
      for (let k = 0; k < 6; k++) o.b(22 + k * 10, 0, 44 - k * 8, 12, 4, 20, '#00A651');
    },
    bear(o, i) {
      const c = pick(['#A1887F', '#FFFFFF', '#F4C27A'], i);
      o.s(0, 0, 14, 14, c); o.s(0, 0, 34, 11, c); o.s(-8, 0, 43, 4, c); o.s(8, 0, 43, 4, c);
      o.s(0, 9, 32, 4, '#D7CCC8');
    }
  };

  /* ---------- walls along the road edges (style per zone) ---------- */
  function buildWalls(B, t) {
    const paths = [t.main, t.branch].filter(Boolean);
    let rackStep = 0;
    for (const path of paths) {
      const { pts, n, closed, cum } = path, m = closed ? n : n - 1;
      for (let i = 0; i < m; i++) {
        const a = pts[i], bb = pts[(i + 1) % n];
        const dx = bb.x - a.x, dz = bb.y - a.y, len = Math.hypot(dx, dz);
        if (len < 1) continue;
        const ux = dx / len, uz = dz / len, nx = -uz, nz = ux, rot = -Math.atan2(dz, dx);
        const zone = TR.zoneAt(t, path === t.main ? cum[i] : t.fork.sF);
        for (const side of [1, -1]) {
          const hw = (a.w + bb.w) / 4 + 5;
          const mx = (a.x + bb.x) / 2 + nx * hw * side, mz = (a.y + bb.y) / 2 + nz * hw * side;
          if (TR.clearance(t, mx + nx * side * 4, mz + nz * side * 4) < 6) continue;   // junction / inside another road
          const L2 = len + 3, st = zone.wall;
          if (st === 'room') {
            B.b(mx, mz, 0, L2, 26, 8, rot, zone.color);
            B.b(mx, mz, 26, L2, 4, 10, rot, i % 6 < 3 ? '#0058A3' : '#FFDB00');
          } else if (st === 'rack') {
            B.b(mx, mz, 0, L2, 8, 8, rot, (i % 2) ? '#FFDB00' : '#222222');          // safety barrier
            const ox = mx + nx * side * 34, oz = mz + nz * side * 34;
            if (TR.clearance(t, ox, oz) > 20) {
              B.b(ox, oz, 40, L2, 4, 44, rot, zone.color); B.b(ox, oz, 84, L2, 4, 44, rot, zone.color);
              B.b(ox, oz, 128, L2, 4, 44, rot, zone.color);
              if (rackStep++ % 3 === 0) { B.b(ox, oz, 0, 5, 150, 5, rot, '#0058A3'); }
              B.b(ox, oz, 44, L2 * 0.8, 26 + (i % 3) * 4, 34, rot, CARD);
              if (i % 2) B.b(ox, oz, 88, L2 * 0.7, 30, 34, rot, i % 4 ? CARD : '#E8E8E8');
              if (i % 3 === 0) B.b(ox, oz, 132, L2 * 0.6, 22, 32, rot, CARD);
            }
          } else if (st === 'rail') {
            B.b(mx, mz, 16, L2, 4, 6, rot, zone.color);
            B.b(mx, mz, 0, L2, 6, 6, rot, zone.color);
            if (i % 2 === 0) B.c(mx, mz, 0, 2.5, 18, zone.color);
            B.b(mx, mz, 6, L2, 10, 1.5, rot, '#E8F0F4');
          } else if (st === 'soft') {
            const cs = ['#E4002B', '#FFDB00', '#0058A3', '#00A651'];
            B.b(mx, mz, 0, L2, 22, 14, rot, pick(cs, i + (side > 0 ? 0 : 2)));
          } else if (st === 'counter') {
            B.b(mx, mz, 0, L2, 26, 12, rot, '#D0D0D0');
            B.b(mx, mz, 26, L2, 3, 14, rot, zone.color);
          }
        }
      }
    }
  }

  /* ---------- floor + road textures ---------- */
  function floorTexture(t) {
    const S = 2048 / W;
    return canvasTex(2048, Math.round(H * S), (x, w, h) => {
      x.scale(S, S);
      x.fillStyle = '#D6D3CC'; x.fillRect(0, 0, W, H);
      x.strokeStyle = '#CBC8C0'; x.lineWidth = 2;
      for (let i = 0; i <= W; i += 60) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
      for (let i = 0; i <= H; i += 60) { x.beginPath(); x.moveTo(0, i); x.lineTo(W, i); x.stroke(); }
      x.lineCap = 'round'; x.lineJoin = 'round';
      const { pts, n, cum } = t.main;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        x.strokeStyle = TR.zoneAt(t, cum[i]).tint; x.lineWidth = a.w + 300;
        x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
      }
      for (const p of [t.main, t.branch].filter(Boolean)) {
        const m = p.closed ? p.n : p.n - 1;
        for (let i = 0; i < m; i++) {
          const a = p.pts[i], b = p.pts[(i + 1) % p.n];
          x.strokeStyle = '#E2E2E2'; x.lineWidth = a.w;
          x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke();
        }
      }
    });
  }
  let roadTexCache = null;
  function roadTexture() {
    if (roadTexCache) return roadTexCache;
    roadTexCache = canvasTex(256, 512, (x, w, h) => {
      x.fillStyle = '#E4E4E2'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { x.fillStyle = Math.random() < 0.5 ? '#DCDCDA' : '#EAEAE8'; x.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
      x.fillStyle = '#FFDB00';
      for (let y = 0; y < h; y += 128) { x.fillRect(4, y, 10, 80); x.fillRect(w - 14, y, 10, 80); }
      // IKEA "follow the arrows" floor arrow (points along +v = driving direction)
      x.fillStyle = 'rgba(255,255,255,.9)';
      x.beginPath(); x.moveTo(w / 2, 470); x.lineTo(w / 2 - 50, 380); x.lineTo(w / 2 - 20, 380); x.lineTo(w / 2 - 20, 300);
      x.lineTo(w / 2 + 20, 300); x.lineTo(w / 2 + 20, 380); x.lineTo(w / 2 + 50, 380); x.closePath(); x.fill();
    }, true);
    return roadTexCache;
  }
  function roadMesh(path, y) {
    const { pts, n, closed, cum } = path, cnt = closed ? n + 1 : n;
    const pos = new Float32Array(cnt * 2 * 3), uv = new Float32Array(cnt * 2 * 2), idx = [];
    for (let k = 0; k < cnt; k++) {
      const i = k % n, p = pts[i];
      const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      let dx = b.x - a.x, dz = b.y - a.y; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      const nx = -dz, nz = dx, hw = p.w / 2, v = (k === n ? path.L : cum[i]) / 160;
      pos.set([p.x + nx * hw, y, p.y + nz * hw, p.x - nx * hw, y, p.y - nz * hw], k * 6);
      uv.set([0, v, 1, v], k * 4);
      if (k < cnt - 1) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    const g = new T3.BufferGeometry();
    g.setAttribute('position', new T3.BufferAttribute(pos, 3)); g.setAttribute('uv', new T3.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new T3.Mesh(g, new T3.MeshLambertMaterial({ map: roadTexture(), side: T3.DoubleSide }));
    return m;
  }
  function signMesh(text, w, h, bg, fg) {
    const tex = canvasTex(512, Math.round(512 * h / w), (x, cw, ch) => {
      x.fillStyle = bg || '#FFDB00'; x.fillRect(0, 0, cw, ch);
      x.fillStyle = fg || '#0058A3'; x.font = `900 ${Math.round(ch * 0.62)}px "Noto Sans", Verdana, Arial, sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, cw / 2, ch / 2 + 2, cw - 20);
    });
    return new T3.Mesh(new T3.PlaneGeometry(w, h), new T3.MeshBasicMaterial({ map: tex, side: T3.DoubleSide }));
  }
  function labelSprite(text, color) {
    const tex = canvasTex(256, 64, (x, w, h) => {
      x.fillStyle = 'rgba(17,17,17,.8)'; x.fillRect(0, 8, w, 48);
      x.fillStyle = color; x.fillRect(0, 8, 12, 48);
      x.fillStyle = '#fff'; x.font = '900 32px "Noto Sans", Verdana, Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(text, w / 2 + 6, 34, w - 24);
    });
    const s = new T3.Sprite(new T3.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(64, 16, 1); s.renderOrder = 10;
    return s;
  }

  /* ---------- the store ---------- */
  function buildStore(t) {
    const group = new T3.Group(), B = new Batch();
    // floor + ceiling
    const floor = new T3.Mesh(new T3.PlaneGeometry(W + 800, H + 800), new T3.MeshLambertMaterial({ color: '#D2CFC8' }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, -0.5, H / 2); group.add(floor);
    const f2 = new T3.Mesh(new T3.PlaneGeometry(W, H), new T3.MeshLambertMaterial({ map: floorTexture(t) }));
    f2.rotation.x = -Math.PI / 2; f2.position.set(W / 2, 0, H / 2); group.add(f2);
    const ceil = new T3.Mesh(new T3.PlaneGeometry(W + 800, H + 800), new T3.MeshBasicMaterial({ color: '#4A4F55', side: T3.DoubleSide }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(W / 2, CEIL, H / 2); ceil.userData.ceiling = true; group.add(ceil);
    const CB = new Batch(), ceilGroup = new T3.Group(); ceilGroup.userData.ceiling = true;
    for (let x = 100; x < W; x += 200) for (let z = 100; z < H; z += 200) CB.g(x, z, CEIL - 6, 70, 3, 18);
    CB.build(ceilGroup); group.add(ceilGroup);
    // outer store walls
    B.b(W / 2, -60, 0, W + 240, CEIL, 20, 0, '#E9E6DF'); B.b(W / 2, H + 60, 0, W + 240, CEIL, 20, 0, '#E9E6DF');
    B.b(-60, H / 2, 0, 20, CEIL, H + 240, 0, '#E9E6DF'); B.b(W + 60, H / 2, 0, 20, CEIL, H + 240, 0, '#E9E6DF');
    B.b(W / 2, -48, 150, W + 200, 30, 4, 0, '#0058A3');
    // roads
    group.add(roadMesh(t.main, 0.6));
    if (t.branch) group.add(roadMesh(t.branch, 0.9));
    buildWalls(B, t);
    // columns + furniture fill the store floor
    for (let x = 200; x < W; x += 400) for (let z = 150; z < H; z += 400) if (TR.clearance(t, x, z) > 40) B.c(x, z, 0, 12, CEIL, '#BDBDBD');
    const used = [];
    let k = 0;
    for (let x = 60; x < W - 40; x += 105) for (let z = 60; z < H - 40; z += 105) {
      const jx = x + ((k * 37) % 30) - 15, jz = z + ((k * 53) % 30) - 15; k++;
      const c = TR.clearance(t, jx, jz);
      if (c < 62 || c > 520) continue;
      const pr = TR.projectPath(t.main, jx, jz), zone = TR.zoneAt(t, pr.s);
      const kind = pick(zone.deco, k);
      if (zone.wall === 'rack' && c < 95) continue;                 // racks already there
      const face = Math.atan2(pr.py - jz, pr.px - jx) - Math.PI / 2;     // furniture faces the road
      const o = L(B, jx, jz, face);
      if (zone.wall === 'room' && k % 2 === 0 && c > 90) {               // showroom "room" with back walls, like the real store
        o.b(0, -58, 0, 150, 64, 6, zone.color === '#FFFFFF' ? '#EDEAE4' : zone.color);
        o.b(-75, -22, 0, 6, 64, 78, '#E6E2DA');
        o.b(0, -58, 64, 152, 4, 8, '#0058A3');
      }
      FURN[kind](o, k);
      if (k % 3 === 0) { o.c(34, 30, 0, 1, 20, '#333333'); o.b(34, 30, 20, 18, 11, 2, '#FFDB00'); }     // yellow price tag
    }
    // obstacles + pads
    t.obstacles.forEach((o, i) => {
      if (o.kind === 'table') FURN.table(L(B, o.x, o.y, i), i);
      else B.s(o.x, o.y, o.r, o.r, pick(['#E4002B', '#0058A3', '#FFDB00', '#00A651', '#FF7A00'], i));
    });
    t.pads.forEach(p => {
      const o = L(B, p.x, p.y, p.ang);
      if (p.type === 'ramp') {
        for (let k2 = 0; k2 < 5; k2++) o.b(-p.r + k2 * p.r * 0.4, 0, 0, p.r * 0.4 + 1, 2 + k2 * 4, p.r * 2.4, k2 % 2 ? '#FFDB00' : '#0058A3');
      } else {
        o.b(0, 0, 0.8, p.r * 2, 1, p.r * 2, '#FFDB00');
        for (const dx of [-8, 6]) { o.b(dx, -7, 1.6, 4, 1, 16, '#0058A3'); }
      }
    });
    // jump ramps: full-width wedges with yellow/blue stripes
    t.ramps.forEach(rp => {
      const o = L(B, rp.x, rp.y, rp.ang), w = rp.w - 6;
      for (let k = 0; k < 8; k++) o.b(-36 + k * 5, 0, 0, 5.5, 2 + k * 2.2, w, k % 2 ? '#FFDB00' : '#0058A3');
      o.b(4, 0, 0, 6, 19, w, '#222222');
      for (const sd of [-1, 1]) o.b(-14, sd * (w / 2 + 4), 0, 44, 22, 4, '#E4002B');
    });
    B.build(group);
    // start / finish line + arch
    const a = t.main.pts[0], b = t.main.pts[1], ang = Math.atan2(b.y - a.y, b.x - a.x);
    const check = canvasTex(64, 256, (x, w, h) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#0058A3' : '#FFDB00'; x.fillRect(j * 32, i * 32, 32, 32); } });
    const line = new T3.Mesh(new T3.PlaneGeometry(24, a.w), new T3.MeshBasicMaterial({ map: check }));
    line.rotation.set(-Math.PI / 2, 0, -ang); line.position.set(a.x, 1.2, a.y); group.add(line);
    const arch = new T3.Group();
    const postM = new T3.MeshLambertMaterial({ color: '#0058A3' });
    for (const sd of [-1, 1]) { const post = new T3.Mesh(new T3.BoxGeometry(8, 110, 8), postM); post.position.set(0, 55, sd * (a.w / 2 + 10)); arch.add(post); }
    const banner = signMesh(t.finish, a.w + 28, 30); banner.position.set(0, 100, 0); banner.rotation.y = Math.PI / 2; arch.add(banner);
    arch.position.set(a.x, 0, a.y); arch.rotation.y = -ang; group.add(arch);
    // hanging zone signs over the road
    t.zones.forEach(z => {
      const pt = TR.pointAt(t.main, (z.a + 0.03) * t.L);
      const sg = signMesh(z.name, Math.min(pt.w, 40 + z.name.length * 11), 26);
      sg.position.set(pt.x, 112, pt.y); sg.rotation.y = -pt.ang - Math.PI / 2;
      const wire = new T3.Mesh(new T3.BoxGeometry(1, CEIL - 125, 1), new T3.MeshBasicMaterial({ color: '#333' }));
      wire.position.set(pt.x, 125 + (CEIL - 125) / 2, pt.y);
      wire.userData.ceiling = true;
      group.add(sg, wire);
    });
    if (t.branch) {
      const mid = TR.pointAt(t.branch, t.branch.L * 0.25);
      const sg = signMesh('SCORCIATOIA →', 100, 22, '#0058A3', '#FFDB00');
      sg.position.set(mid.x, 100, mid.y); sg.rotation.y = -mid.ang - Math.PI / 2; group.add(sg);
    }
    return group;
  }

  /* ---------- karts ---------- */
  function makeKart(color, name) {
    const g = new T3.Group(), mats = [];
    const M = c => { const m = new T3.MeshLambertMaterial({ color: c }); mats.push(m); return m; };
    const add = (geo, m, x, y, z, rx, ry, rz) => { const o = new T3.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx || 0, ry || 0, rz || 0); g.add(o); return o; };
    const body = M(color), dark = M('#222222'), skin = M('#F1C27D'), shirt = M('#0058A3'), yel = M('#FFDB00');
    const stripe = M(color.toUpperCase() === '#FFDB00' ? '#0058A3' : '#FFDB00');
    add(new T3.BoxGeometry(30, 7, 18), body, 0, 7, 0);
    add(new T3.BoxGeometry(10, 5, 14), body, 16, 6, 0);
    add(new T3.BoxGeometry(32, 1.5, 4), stripe, 0, 11, 0);
    add(new T3.BoxGeometry(6, 6, 20), dark, -15, 9, 0);                          // rear bumper / engine
    for (const sd of [-1, 1]) add(new T3.CylinderGeometry(1.6, 1.6, 6, 8), M('#9E9E9E'), -18, 11, sd * 5, 0, 0, Math.PI / 2);
    const wheelGeo = new T3.CylinderGeometry(5, 5, 4, 12);
    for (const [x, z] of [[-10, -11], [-10, 11], [11, -10], [11, 10]]) add(wheelGeo, dark, x, 5, z, Math.PI / 2, 0, 0);
    add(new T3.BoxGeometry(8, 8, 12), dark, -4, 12, 0);                         // seat
    add(new T3.CylinderGeometry(4.5, 5.5, 11, 10), shirt, -1, 19, 0);           // driver
    add(new T3.SphereGeometry(5.2, 12, 10), skin, 0, 28, 0);
    add(new T3.SphereGeometry(5.8, 12, 10, 0, TAU, 0, Math.PI / 1.8), body, -0.5, 28.5, 0);   // helmet
    add(new T3.BoxGeometry(1.5, 2.5, 7), yel, 5.3, 28, 0);                       // visor stripe
    add(new T3.CylinderGeometry(4, 4, 1.2, 12), dark, 7, 16, 0, 0, 0, Math.PI / 2.6);          // steering wheel
    const shadow = new T3.Mesh(new T3.CircleGeometry(17, 16), new T3.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    const root = new T3.Group(); root.add(g);
    const label = labelSprite(name, color); label.position.y = 46; root.add(label);
    return { root, kart: g, shadow, mats, body, label, color: col(color) };
  }

  /* ---------- dynamic object pools ---------- */
  function boxTexture() {
    return canvasTex(128, 128, (x, w, h) => {
      x.fillStyle = '#0058A3'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#FFDB00'; x.lineWidth = 8; x.strokeRect(6, 6, w - 12, h - 12);
      x.fillStyle = '#FFDB00'; x.font = '900 90px Verdana, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('?', w / 2, h / 2 + 6);
    });
  }
  class Pool {
    constructor(scene, make) { this.scene = scene; this.make = make; this.items = []; this.used = 0; }
    begin() { this.used = 0; }
    get() { if (this.used >= this.items.length) { const o = this.make(); this.items.push(o); this.scene.add(o); } const o = this.items[this.used++]; o.visible = true; return o; }
    end() { for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false; }
  }
  function itemMesh(type) {
    const g = new T3.Group();
    const add = (geo, c, x, y, z, sx, sy, sz) => { const m = new T3.Mesh(geo, new T3.MeshLambertMaterial({ color: c })); m.position.set(x, y, z); if (sx) m.scale.set(sx, sy, sz); g.add(m); return m; };
    const S = new T3.SphereGeometry(1, 12, 8), Bx = new T3.BoxGeometry(1, 1, 1);
    if (type === 'green' || type === 'red') add(Bx, type === 'green' ? '#00A651' : '#E4002B', 0, 10, 0, 22, 8, 18);
    else if (type === 'mash') { add(S, '#FFF1C1', -5, 4, 0, 9, 6, 9); add(S, '#FFF1C1', 6, 4, 3, 8, 6, 8); add(S, '#FFF1C1', 0, 7, -4, 8, 6, 8); add(S, '#8D5524', 0, 9, 0, 4, 2, 4); }
    else if (type === 'box') { add(Bx, CARD, 0, 12, 0, 24, 24, 24); add(Bx, '#8A6634', 0, 24.2, 0, 5, 0.5, 24); }
    return g;
  }
  function eventMesh(k) {
    const B = new Batch(), g = new T3.Group();
    if (k === 'forklift') {
      B.b(0, 0, 4, 40, 18, 28, 0, '#FF7A00'); B.b(-6, 0, 22, 18, 22, 22, 0, '#222222'); B.b(-14, 0, 22, 4, 40, 26, 0, '#FF7A00');
      B.b(26, -9, 2, 22, 2, 4, 0, '#9E9E9E'); B.b(26, 9, 2, 22, 2, 4, 0, '#9E9E9E'); B.b(18, 0, 2, 3, 50, 26, 0, '#555555');
      for (const [x, z] of [[-12, -15], [-12, 15], [12, -15], [12, 15]]) B.c(x, z, 0, 6, 8, '#222222');
      B.s(-6, 0, 48, 4, '#FFDB00');
    } else if (k === 'cart') {
      FURN.cart(L(B, 0, 0, 0), 0);
    } else if (k === 'cleaning') {
      B.c(0, 0, 0, 5, 20, '#0058A3'); B.s(0, 0, 26, 6, '#F1C27D'); B.c(14, 0, 0, 1, 26, '#9E9E9E'); B.b(14, 0, 0, 6, 2, 16, 0, '#B3E5FC');
      B.b(-22, 0, 0, 14, 22, 2, 0, '#FFDB00');
    } else if (k === 'icecream') {
      B.c(0, 0, 0, 5, 14, CARD); B.s(0, 0, 18, 8, '#FFF3E0'); B.s(0, 0, 26, 6, '#F48FB1'); B.s(2, 0, 32, 2.5, '#E4002B');
    }
    B.build(g);
    return g;
  }

  /* ---------- particles ---------- */
  class Sparks {
    constructor(scene, max) {
      this.max = max; this.n = 0; this.p = [];
      this.geo = new T3.BufferGeometry();
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
      this.geo.setAttribute('position', new T3.BufferAttribute(this.pos, 3));
      this.geo.setAttribute('color', new T3.BufferAttribute(this.col, 3));
      this.pts = new T3.Points(this.geo, new T3.PointsMaterial({ size: 7, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
      this.pts.frustumCulled = false; scene.add(this.pts);
    }
    emit(x, y, z, o) {
      o = o || {};
      const cs = (o.colors || [o.color || '#FFDB00']).map(col);
      for (let i = 0; i < (o.n || 8) && this.p.length < this.max; i++) {
        const a = o.dir != null ? o.dir + (Math.random() - 0.5) * (o.spread || 0.8) : Math.random() * TAU, sp = (o.speed || 80) * (0.4 + Math.random() * 0.8);
        this.p.push({ x, y, z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: (o.up || 30) * Math.random(), life: (o.life || 0.6) * (0.6 + Math.random() * 0.6), c: cs[i % cs.length], g: o.gravity == null ? 60 : o.gravity });
      }
    }
    update(dt) {
      this.p = this.p.filter(q => (q.life -= dt) > 0);
      this.p.forEach((q, i) => {
        q.x += q.vx * dt; q.z += q.vz * dt; q.y = Math.max(1, q.y + q.vy * dt); q.vy -= q.g * dt; q.vx *= 0.95; q.vz *= 0.95;
        this.pos.set([q.x, q.y, q.z], i * 3);
        const f = Math.min(1, q.life * 2); this.col.set([q.c.r * f + (1 - f), q.c.g * f + (1 - f), q.c.b * f + (1 - f)], i * 3);
      });
      this.geo.setDrawRange(0, this.p.length);
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.color.needsUpdate = true;
    }
  }

  /* ---------- public view object ---------- */
  function createView(canvas, opts) {
    opts = opts || {};
    const renderer = new T3.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(opts.maxDpr || 1.5, window.devicePixelRatio || 1));
    const scene = new T3.Scene();
    scene.background = col('#E9E6DF');
    scene.add(new T3.HemisphereLight(0xffffff, 0x9a958c, 1.1));
    const sun = new T3.DirectionalLight(0xffffff, 1.1); sun.position.set(300, 800, 500); scene.add(sun);
    const camera = new T3.PerspectiveCamera(68, 1, 2, 6000);
    const v = {
      renderer, scene, camera, track: null, store: null, cars: {}, karts: {}, mode: opts.mode || 'chase',
      camH: null, camPos: new T3.Vector3(), fov: 68, sparks: new Sparks(scene, 900), boxTex: boxTexture(),
      flashUntil: 0
    };
    const boxMat = new T3.MeshLambertMaterial({ map: v.boxTex, transparent: true, opacity: 0.9 });
    v.boxMesh = new T3.InstancedMesh(new T3.BoxGeometry(22, 22, 22), boxMat, 80); v.boxMesh.count = 0; scene.add(v.boxMesh);
    v.pools = {
      green: new Pool(scene, () => itemMesh('green')), red: new Pool(scene, () => itemMesh('red')),
      mash: new Pool(scene, () => itemMesh('mash')), box: new Pool(scene, () => itemMesh('box')),
      drop: new Pool(scene, () => { const g = new T3.Group(); g.add(itemMesh('mash')); g.add(itemMesh('box')); g.add(itemMesh('red'));
        const ring = new T3.Mesh(new T3.RingGeometry(30, 36, 24), new T3.MeshBasicMaterial({ color: '#E4002B', side: T3.DoubleSide, transparent: true, opacity: 0.8 }));
        ring.rotation.x = -Math.PI / 2; ring.name = 'ring'; g.add(ring); return g; }),
      forklift: new Pool(scene, () => eventMesh('forklift')), cart: new Pool(scene, () => eventMesh('cart')),
      cleaning: new Pool(scene, () => eventMesh('cleaning')), icecream: new Pool(scene, () => eventMesh('icecream')),
      shelf: new Pool(scene, () => { const g = new T3.Group();
        const warn = new T3.Mesh(new T3.PlaneGeometry(1, 1), new T3.MeshBasicMaterial({ color: '#E4002B', transparent: true, opacity: 0.45 }));
        warn.rotation.x = -Math.PI / 2; warn.position.y = 1.5; warn.name = 'warn'; g.add(warn);
        const sh = new T3.Group(); sh.name = 'shelf';
        const B = new Batch(); B.b(0, 0, 0, 26, 18, 1, 0, BIRCH);
        for (let k = 0; k < 4; k++) B.b(((k * 7) % 12) - 6, -0.5 + k * 0.25, 18, 10, 10, 10, k * 0.4, CARD);
        B.build(sh); g.add(sh); return g; })
    };
    v.setTrack = (t) => {
      if (v.store) { scene.remove(v.store); v.store.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
      v.track = t; v.store = buildStore(t); scene.add(v.store);
      v.store.traverse(o => { if (o.userData && o.userData.ceiling) o.visible = v.mode === 'chase'; });
      scene.fog = v.mode === 'chase' ? new T3.Fog('#E9E6DF', 700, 1900) : null;
    };
    v.setMode = (m) => {
      v.mode = m;
      if (v.store) v.store.traverse(o => { if (o.userData && o.userData.ceiling) o.visible = m === 'chase'; });
      scene.fog = m === 'chase' ? new T3.Fog('#E9E6DF', 700, 1900) : null;
    };
    v.setCars = (cars) => {
      for (const id in v.karts) { scene.remove(v.karts[id].root); scene.remove(v.karts[id].shadow); }
      v.karts = {}; v.cars = cars;
      for (const id in cars) { const k = makeKart(cars[id].color, cars[id].name); v.karts[id] = k; scene.add(k.root, k.shadow); }
    };
    v.resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      const pr = renderer.getPixelRatio();
      if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    // world point under a screen position (sabotage throws)
    v.pick = (clientX, clientY) => {
      const r = canvas.getBoundingClientRect();
      const ndc = new T3.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      const ray = new T3.Raycaster(); ray.setFromCamera(ndc, camera);
      const hit = new T3.Vector3();
      return ray.ray.intersectPlane(new T3.Plane(new T3.Vector3(0, 1, 0), 0), hit) ? { x: hit.x, y: hit.z } : null;
    };
    v.fx = (f) => {
      const s = v.sparks;
      switch (f.k) {
        case 'flame': s.emit(f.x, 10, f.y, { n: 40, colors: ['#FF7A00', '#E4002B', '#FFDB00'], speed: 220, up: 80, life: 0.7 }); break;
        case 'hit': s.emit(f.x, 14, f.y, { n: 22, colors: ['#FFFFFF', '#BDBDBD', '#E4002B'], speed: 140, up: 120, life: 0.6 }); break;
        case 'splash': s.emit(f.x, 8, f.y, { n: 26, colors: ['#E4002B', '#FFFFFF'], speed: 160, up: 100, life: 0.6 }); break;
        case 'box': s.emit(f.x, 14, f.y, { n: 18, colors: ['#0058A3', '#FFDB00', '#FFFFFF'], speed: 120, up: 120, life: 0.6 }); break;
        case 'wall': s.emit(f.x, 8, f.y, { n: 8, colors: ['#FFDB00', '#FFFFFF'], speed: 90, up: 60, life: 0.35 }); break;
        case 'poof': case 'bonk': case 'clean': s.emit(f.x, 10, f.y, { n: 10, color: '#FFFFFF', speed: 80, life: 0.4 }); break;
        case 'flag': v.flashUntil = performance.now() + 2000; break;
        case 'land': s.emit(f.x, 4, f.y, { n: f.trick ? 30 : 14, colors: f.trick ? ['#FFDB00', '#FF7A00', '#FFFFFF'] : ['#FFFFFF', '#CFCFCF'], speed: f.trick ? 180 : 110, up: 60, life: 0.5 }); break;
      }
    };

    // per-frame update from a server snapshot + interpolated positions
    v.update = (st, disp, dt, now, o) => {
      o = o || {};
      const s = v.sparks;
      // karts
      for (const p of st.p) {
        const k = v.karts[p.i], d = disp[p.i];
        if (!k || !d) continue;
        const ghost = p.f & 32, isMe = o.me === p.i, show = !p.fin && (!ghost || isMe || o.host);
        k.root.visible = k.shadow.visible = show;
        if (!show) continue;
        // jump arc from the server's airtime (smoothed on the local clock)
        let jump = 0, jf = 0;
        if (p.j) {
          if (d.jS == null || Math.abs((now - d.jS) - p.j[0]) > 250) d.jS = now - p.j[0];
          d.jD = p.j[1];
          jf = Math.min(1, (now - d.jS) / d.jD);
          jump = 4 * (30 + 0.035 * d.jD) * jf * (1 - jf);
        } else d.jS = null;
        d.jy = jump;
        k.root.position.set(d.x, jump, d.y); k.root.rotation.y = -d.h;
        const big = v.mode === 'overview' ? 2.4 : 1;                    // easier to see on the projector
        k.kart.scale.setScalar(big); k.label.scale.set(64 * big * 1.3, 16 * big * 1.3, 1); k.label.position.y = 46 * big;
        k.kart.rotation.z = jump ? (0.5 - jf) * 0.45 : 0;                               // nose up, then down
        k.kart.rotation.x = (p.f & 8) ? Math.sin(now / 60) * 0.25 : 0;
        if ((p.f & 1024) && jump) k.kart.rotation.y = jf * Math.PI * 2;                   // trick: 360° spin
        else if (p.f & 8) k.kart.rotation.y += dt * 12; else k.kart.rotation.y *= 0.8;     // spin-out
        k.shadow.position.set(d.x, 0.9, d.y); k.shadow.scale.setScalar(Math.max(0.4, 1 - jump / 140) * (v.mode === 'overview' ? 2.4 : 1));
        k.label.visible = !!o.names && !isMe;
        const alpha = ghost ? (isMe ? 0.45 : 0.25) : 1;
        const invi = p.f & 16, flash = invi && Math.floor(now / 90) % 2;
        for (const m of k.mats) { m.transparent = alpha < 1; m.opacity = alpha; }
        k.body.color.copy(flash ? col('#FFDB00') : k.color);
        k.body.emissive = k.body.emissive || new T3.Color(); k.body.emissive.set(invi ? '#553300' : '#000000');
        // trails
        const bx = d.x - Math.cos(d.h) * 18, bz = d.y - Math.sin(d.h) * 18, back = d.h + Math.PI;
        if (p.f & 2) s.emit(bx, 10, bz, { n: 3, colors: ['#F2B705', '#FFDB00', '#FFFFFF'], dir: back, spread: 1, speed: 90, up: 40, life: 0.8 });
        else if (p.f & 512) s.emit(bx, 8, bz, { n: 2, colors: ['#8D5524', '#A0522D'], dir: back, spread: 0.4, speed: 50, life: 1, gravity: 0 });
        else if (p.f & 1) s.emit(bx, 9, bz, { n: 2, colors: ['#FF7A00', '#FFDB00'], dir: back, spread: 0.5, speed: 80, life: 0.35, gravity: 0 });
        if (invi) s.emit(d.x, 14, d.y, { n: 1, colors: ['#FFDB00', '#E4002B'], speed: 70, up: 60, life: 0.4 });
      }
      // item boxes
      const dummy = new T3.Object3D();
      v.boxMesh.count = st.b.length;
      st.b.forEach((b, i) => {
        dummy.position.set(b[0], 16 + Math.sin(now / 300 + i) * 3, b[1]); dummy.rotation.set(0.5, now / 700 + i, 0.3);
        dummy.scale.setScalar(1); dummy.updateMatrix(); v.boxMesh.setMatrixAt(i, dummy.matrix);
      });
      v.boxMesh.instanceMatrix.needsUpdate = true;
      // projectiles / traps / drops / events
      for (const k in v.pools) v.pools[k].begin();
      st.q.forEach(q => { const m = v.pools[q[2] === 'red' ? 'red' : 'green'].get(); m.position.set(q[0], 0, q[1]); m.rotation.y = now / 80; });
      st.tr.forEach(t => { const m = v.pools[t[2] === 'mash' ? 'mash' : 'box'].get(); m.position.set(t[0], 0, t[1]); });
      st.d.forEach(dr => {
        const g = v.pools.drop.get(), k = Math.max(0, Math.min(1, dr[3] / 700));
        g.position.set(dr[0], 0, dr[1]);
        const [mash, box, red, ring] = g.children;
        mash.visible = dr[2] === 'mash'; box.visible = dr[2] === 'box'; red.visible = dr[2] === 'pillow';
        for (const c of [mash, box, red]) c.position.y = 220 * k;
        ring.scale.setScalar(0.4 + k);
      });
      st.e.forEach(e => {
        if (e.k === 'blackout') return;
        if (e.k === 'icecream') {
          const d = disp[e.tg]; if (!d) return;
          const m = v.pools.icecream.get(); m.position.set(d.x, 50 + Math.sin(now / 120) * 5, d.y); m.rotation.y = now / 300; return;
        }
        if (e.k === 'shelf') {
          const g = v.pools.shelf.get(); g.position.set(e.x, 0, e.y); g.rotation.y = -e.a;
          const warn = g.getObjectByName('warn'), sh = g.getObjectByName('shelf');
          warn.visible = !!e.w && Math.floor(now / 150) % 2 === 0; warn.scale.set(30, (e.len || 40) + 12, 1);
          sh.visible = !e.w; sh.scale.set(1, 1, ((e.len || 40) + 8) / 1);
          return;
        }
        const pool = v.pools[e.k]; if (!pool) return;
        const m = pool.get(); m.position.set(e.x, 0, e.y); m.rotation.y = -e.a;
      });
      for (const k in v.pools) v.pools[k].end();
      s.update(dt);
      // camera
      if (v.mode === 'chase' && o.me && disp[o.me]) chaseCam(v, disp[o.me], st.p.find(p => p.i === o.me), dt);
      else overviewCam(v, o.panel || 0);
    };
    v.render = () => { v.resize(); renderer.render(scene, camera); };
    return v;
  }

  function chaseCam(v, d, p, dt) {
    const cam = v.camera;
    if (v.camH == null) v.camH = d.h;
    v.camH += Math.atan2(Math.sin(d.h - v.camH), Math.cos(d.h - v.camH)) * Math.min(1, dt * 5);
    const boost = p && (p.f & 1), dist = 92, hgt = 46;
    let cx = d.x - Math.cos(v.camH) * dist, cz = d.y - Math.sin(v.camH) * dist;
    // keep the camera above the road so walls never block the view
    for (let i = 0; i < 6 && TR.clearance(v.track, cx, cz) > -6; i++) { cx = (cx + d.x) / 2; cz = (cz + d.y) / 2; }
    const jy = (d.jy || 0) * 0.7;
    v.camPos.set(cx, hgt + jy, cz);
    cam.position.lerp(v.camPos, 1 - Math.exp(-dt * 10));
    // clamp the smoothed position too, so it never cuts a corner through the shelves
    for (let i = 0; i < 6 && TR.clearance(v.track, cam.position.x, cam.position.z) > -6; i++) {
      cam.position.x = (cam.position.x + d.x) / 2; cam.position.z = (cam.position.z + d.y) / 2;
    }
    cam.lookAt(d.x + Math.cos(v.camH) * 110, 8 + jy, d.y + Math.sin(v.camH) * 110);
    const fov = boost ? 82 : 70;
    v.fov += (fov - v.fov) * Math.min(1, dt * 4);
    if (Math.abs(cam.fov - v.fov) > 0.05) { cam.fov = v.fov; cam.updateProjectionMatrix(); }
  }
  function overviewCam(v, panel) {
    const cam = v.camera;
    const a = cam.aspect, fov = 40, tilt = 0.95;                 // radians from horizontal
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const vf = Math.tan(fov * Math.PI / 360);
    const dist = Math.max((W * 0.57) / (vf * a), (H * 0.64) / vf);
    cam.position.set(W / 2, Math.sin(tilt) * dist, H / 2 + Math.cos(tilt) * dist);
    cam.lookAt(W / 2, 0, H / 2 + 30);
  }

  window.IKEA_3D = { createView, makeKart };
})();
