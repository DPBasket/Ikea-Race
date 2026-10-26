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
