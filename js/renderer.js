/**
 * Canvas renderer. The static playfield (walls, paint, labels, stars) is
 * baked into an offscreen canvas once per resize; every frame then draws that
 * bitmap plus the handful of things that actually move. That is what keeps it
 * at 60fps on a phone.
 */

import { TABLE_W, TABLE_H, BALL_R } from './physics.js';
import { DOME, DRAIN_Y, LANE_X, ORBIT_INNER_R } from './table.js';

const PIXEL = "'Press Start 2P', 'Courier New', monospace";
const MONO = "'Share Tech Mono', 'Courier New', monospace";

const COL = {
  rail: '#7d95c9',
  railDark: '#2b3a63',
  dome: '#5f7cb8',
  floor0: '#0b1030',
  floor1: '#050718',
  cyan: '#2ee6ff',
  pink: '#ff2e88',
  amber: '#ffc23a',
  green: '#8cff4a',
  violet: '#c56bff',
  orange: '#ff6a3d',
};

/** Deterministic pseudo-random so the starfield never shimmers. */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.dpr = 1;
    this.bg = document.createElement('canvas');
    this.quality = 'high';
    this.table = null;
  }

  setTable(table) {
    this.table = table;
    this.bgDirty = true;
  }

  resize(cssW, cssH) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';

    this.scale = Math.min(cssW / TABLE_W, cssH / TABLE_H);
    this.ox = (cssW - TABLE_W * this.scale) / 2;
    this.oy = (cssH - TABLE_H * this.scale) / 2;
    this.bgDirty = true;
  }

  /** Map table space to device pixels. */
  applyTransform(ctx, shakeX = 0, shakeY = 0) {
    ctx.setTransform(
      this.scale * this.dpr, 0, 0, this.scale * this.dpr,
      (this.ox + shakeX) * this.dpr, (this.oy + shakeY) * this.dpr
    );
  }

  // =====================================================================
  // Static layer
  // =====================================================================
  buildBackground() {
    const bg = this.bg;
    bg.width = this.canvas.width;
    bg.height = this.canvas.height;
    const ctx = bg.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#03040c';
    ctx.fillRect(0, 0, bg.width, bg.height);
    this.applyTransform(ctx);

    this.drawSpace(ctx);
    this.drawFloor(ctx);
    this.drawPaint(ctx);
    this.drawWalls(ctx);
    this.drawLabels(ctx);
    this.bgDirty = false;
  }

  drawSpace(ctx) {
    const r = rng(20250409);
    // Nebula washes behind the playfield.
    for (const [x, y, rad, c] of [
      [DOME.x, DOME.y - 60, 420, 'rgba(70,40,150,0.45)'],
      [90, 620, 320, 'rgba(20,70,140,0.35)'],
      [430, 760, 300, 'rgba(120,30,90,0.3)'],
    ]) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, TABLE_W, TABLE_H);
    }
    for (let i = 0; i < 260; i++) {
      const x = r() * TABLE_W;
      const y = r() * TABLE_H;
      const s = r();
      ctx.fillStyle = `rgba(255,255,255,${0.15 + s * 0.6})`;
      ctx.fillRect(x, y, s > 0.9 ? 2 : 1, s > 0.9 ? 2 : 1);
    }
  }

  drawFloor(ctx) {
    // The playfield itself: a slightly lighter inlay inside the walls.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(28, DOME.y);
    ctx.arc(DOME.x, DOME.y, DOME.r, Math.PI, 0);
    ctx.lineTo(532, TABLE_H);
    ctx.lineTo(28, TABLE_H);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 100, 0, TABLE_H);
    g.addColorStop(0, COL.floor0);
    g.addColorStop(0.55, '#070b22');
    g.addColorStop(1, COL.floor1);
    ctx.fillStyle = g;
    ctx.fill();

    // Faint grid for that "vector table" feel.
    ctx.clip();
    ctx.strokeStyle = 'rgba(120,160,255,0.055)';
    ctx.lineWidth = 1;
    for (let x = 28; x <= 532; x += 28) {
      ctx.beginPath();
      ctx.moveTo(x, 80);
      ctx.lineTo(x, TABLE_H);
      ctx.stroke();
    }
    for (let y = 88; y <= TABLE_H; y += 28) {
      ctx.beginPath();
      ctx.moveTo(28, y);
      ctx.lineTo(532, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawPaint(ctx) {
    const t = this.table;

    // Launch lane: chevrons pointing up the chute.
    ctx.save();
    ctx.beginPath();
    ctx.rect(LANE_X + 4, 320, 60, 630);
    ctx.clip();
    ctx.fillStyle = 'rgba(46,230,255,0.07)';
    ctx.fillRect(LANE_X + 4, 320, 60, 630);
    ctx.strokeStyle = 'rgba(46,230,255,0.3)';
    ctx.lineWidth = 3;
    for (let y = 920; y > 340; y -= 46) {
      ctx.beginPath();
      ctx.moveTo(LANE_X + 12, y);
      ctx.lineTo(500, y - 18);
      ctx.lineTo(526, y);
      ctx.stroke();
    }
    ctx.restore();

    // Orbit channel: shade the whole loop so the shot reads at a glance.
    ctx.save();
    ctx.strokeStyle = 'rgba(255,194,58,0.1)';
    ctx.lineWidth = DOME.r - ORBIT_INNER_R - 6;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    // Canvas angles are the negatives of the table's polar angles (y is down).
    ctx.arc(DOME.x, DOME.y, (DOME.r + ORBIT_INNER_R) / 2, (-160 * Math.PI) / 180, (-30 * Math.PI) / 180);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,194,58,0.17)';
    ctx.lineWidth = 36;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(444, 520);
    ctx.lineTo(450, 380);
    ctx.stroke();
    ctx.restore();

    // Outlane / inlane channels on both sides.
    for (const flip of [false, true]) {
      ctx.save();
      if (flip) {
        ctx.translate(496, 0);
        ctx.scale(-1, 1);
      }
      ctx.strokeStyle = 'rgba(255,46,136,0.16)';
      ctx.lineWidth = 26;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(58, 800);
      ctx.lineTo(74, 946);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(140,255,74,0.14)';
      ctx.lineWidth = 24;
      ctx.beginPath();
      ctx.moveTo(94, 806);
      ctx.lineTo(132, 858);
      ctx.lineTo(166, 876);
      ctx.stroke();
      ctx.restore();
    }

    // Hole surrounds.
    for (const h of t.holes) {
      const col = h.id === 'wormhole' ? COL.violet : COL.orange;
      for (let i = 3; i >= 1; i--) {
        ctx.strokeStyle = `rgba(${col === COL.violet ? '197,107,255' : '255,106,61'},${0.1 * i})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r + i * 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#01020a';
      ctx.beginPath();
      ctx.arc(h.x, h.y, h.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // Big table logo, printed on the playfield behind everything.
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#9fc4ff';
    ctx.textAlign = 'center';
    ctx.font = `20px ${PIXEL}`;
    ctx.fillText('SPACE', 248, 790);
    ctx.fillText('CADET', 248, 820);
    ctx.restore();
  }

  drawWalls(ctx) {
    const groups = {
      rail: { col: COL.rail, dark: COL.railDark, w: 9 },
      dome: { col: COL.dome, dark: '#243a66', w: 9 },
      guide: { col: '#9ab2e6', dark: '#2b3a63', w: 8 },
    };
    for (const kind of Object.keys(groups)) {
      const g = groups[kind];
      const segs = this.table.segments.filter((s) => s.kind === kind);
      if (!segs.length) continue;
      ctx.lineCap = 'round';
      ctx.strokeStyle = g.dark;
      ctx.lineWidth = g.w + 4;
      ctx.beginPath();
      for (const s of segs) {
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
      }
      ctx.stroke();
      ctx.strokeStyle = g.col;
      ctx.lineWidth = g.w - 3;
      ctx.beginPath();
      for (const s of segs) {
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
      }
      ctx.stroke();
    }

    // Static posts (bumpers and slings are dynamic, so they are skipped).
    for (const c of this.table.circles) {
      if (c.kind !== 'post') continue;
      ctx.fillStyle = '#1a2446';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#b9ccf5';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  drawLabels(ctx) {
    const t = this.table;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Fuel lane letters, set along the dome.
    for (const l of t.lanes) {
      const a = Math.atan2(DOME.y - l.y, l.x - DOME.x);
      const p = { x: DOME.x + Math.cos(a) * 174, y: DOME.y - Math.sin(a) * 174 };
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(-(a - Math.PI / 2));
      ctx.fillStyle = 'rgba(140,255,74,0.5)';
      ctx.font = `13px ${PIXEL}`;
      ctx.fillText(l.letter, 0, 0);
      ctx.restore();
    }

    // Target bank letters sit just behind each target.
    const bank = t.bank;
    const ang = Math.atan2(bank.b.y - bank.a.y, bank.b.x - bank.a.x);
    // Set each letter just behind its target, along the bank's normal.
    const nx = Math.sin(ang);
    const ny = -Math.cos(ang);
    for (const tg of t.targets) {
      const cx = (tg.x1 + tg.x2) / 2 + nx * 19;
      const cy = (tg.y1 + tg.y2) / 2 + ny * 19;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.fillStyle = 'rgba(255,194,58,0.42)';
      ctx.font = `11px ${PIXEL}`;
      ctx.fillText(tg.letter, 0, 0);
      ctx.restore();
    }

    for (const h of t.holes) {
      ctx.fillStyle = h.id === 'wormhole' ? 'rgba(197,107,255,0.65)' : 'rgba(255,106,61,0.65)';
      ctx.font = `8px ${PIXEL}`;
      const words = h.label.split(' ');
      words.forEach((w, i) => ctx.fillText(w, h.x, h.y + h.r + 16 + i * 12));
    }

    ctx.save();
    ctx.translate(446, 392);
    ctx.fillStyle = 'rgba(255,194,58,0.55)';
    ctx.font = `8px ${PIXEL}`;
    ctx.fillText('ORBIT', 0, 0);
    ctx.restore();

    ctx.fillStyle = 'rgba(255,46,136,0.5)';
    ctx.font = `8px ${PIXEL}`;
    ctx.fillText('OUT', 62, 912);
    ctx.fillText('OUT', 434, 912);
  }

  // =====================================================================
  // Dynamic layer
  // =====================================================================
  draw(game) {
    const ctx = this.ctx;
    if (this.bgDirty) this.buildBackground();

    const sh = game.shake;
    const sx = sh ? (Math.random() - 0.5) * sh : 0;
    const sy = sh ? (Math.random() - 0.5) * sh : 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#03040c';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.bg, sx * this.dpr * this.scale, sy * this.dpr * this.scale);
    this.applyTransform(ctx, sx * this.scale, sy * this.scale);

    const t = game.table;
    this.drawDrain(ctx);
    this.drawTargets(ctx, t);
    this.drawLanes(ctx, t);
    this.drawSpinner(ctx, t.spinner);
    this.drawSlings(ctx, t);
    this.drawBumpers(ctx, t);
    this.drawPlunger(ctx, t.plunger, game);
    this.drawFlippers(ctx, t);
    this.drawFlashes(ctx, game);
    this.drawBalls(ctx, game);
    this.drawPopups(ctx, game);
  }

  drawDrain(ctx) {
    const g = ctx.createLinearGradient(0, DRAIN_Y - 60, 0, TABLE_H);
    g.addColorStop(0, 'rgba(255,46,136,0)');
    g.addColorStop(1, 'rgba(255,46,136,0.3)');
    ctx.fillStyle = g;
    ctx.fillRect(28, DRAIN_Y - 60, 440, TABLE_H - DRAIN_Y + 60);
  }

  drawBumpers(ctx, t) {
    for (const b of t.bumpers) {
      const lit = b.flash;
      ctx.save();
      if (lit > 0.02 && this.quality === 'high') {
        ctx.shadowColor = COL.cyan;
        ctx.shadowBlur = 26 * lit;
      }
      // Skirt
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(b.x - 6, b.y - 8, 2, b.x, b.y, b.r);
      g.addColorStop(0, lit > 0.1 ? '#eafcff' : '#3b5aa0');
      g.addColorStop(0.6, lit > 0.1 ? '#2ee6ff' : '#1d2d5c');
      g.addColorStop(1, '#0a1230');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = lit > 0.1 ? '#ffffff' : '#88a6e0';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();

      // Cap
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.46, 0, Math.PI * 2);
      ctx.fillStyle = lit > 0.1 ? '#ffffff' : '#9fc4ff';
      ctx.fill();

      ctx.fillStyle = lit > 0.1 ? '#06233a' : '#0b1430';
      ctx.font = `9px ${PIXEL}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(b.id + 1), b.x, b.y + 1);
    }
  }

  drawSlings(ctx, t) {
    for (const s of t.slings) {
      ctx.save();
      if (s.flash > 0.02 && this.quality === 'high') {
        ctx.shadowColor = COL.pink;
        ctx.shadowBlur = 22 * s.flash;
      }
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
      ctx.lineTo(s.c.x, s.c.y);
      ctx.closePath();
      ctx.fillStyle = '#17204a';
      ctx.fill();
      ctx.strokeStyle = s.flash > 0.1 ? '#ffffff' : COL.pink;
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }

  drawTargets(ctx, t) {
    for (const tg of t.targets) {
      const mx = (tg.x1 + tg.x2) / 2;
      const my = (tg.y1 + tg.y2) / 2;
      const ang = Math.atan2(tg.y2 - tg.y1, tg.x2 - tg.x1);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(ang);
      const len = Math.hypot(tg.x2 - tg.x1, tg.y2 - tg.y1);
      if (tg.down) {
        ctx.fillStyle = 'rgba(255,194,58,0.16)';
        ctx.fillRect(-len / 2, -2, len, 4);
      } else {
        if (tg.flash > 0.02 && this.quality === 'high') {
          ctx.shadowColor = COL.amber;
          ctx.shadowBlur = 18 * tg.flash;
        }
        const g = ctx.createLinearGradient(0, -6, 0, 6);
        g.addColorStop(0, '#fff3cf');
        g.addColorStop(1, '#d98f12');
        ctx.fillStyle = g;
        ctx.fillRect(-len / 2, -6, len, 12);
        ctx.strokeStyle = '#2a1a02';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-len / 2, -6, len, 12);
      }
      ctx.restore();
    }
  }

  drawLanes(ctx, t) {
    for (const l of t.lanes) {
      ctx.save();
      if (l.lit && this.quality === 'high') {
        ctx.shadowColor = COL.green;
        ctx.shadowBlur = 16;
      }
      ctx.beginPath();
      ctx.arc(l.x, l.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = l.lit ? COL.green : 'rgba(140,255,74,0.18)';
      ctx.fill();
      ctx.strokeStyle = l.lit ? '#eaffe0' : 'rgba(140,255,74,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  drawSpinner(ctx, sp) {
    ctx.save();
    ctx.translate(sp.x, sp.y);
    // Lie the plate across the channel, then foreshorten it as it spins.
    ctx.rotate(-(sp.a ?? 0));
    const squash = Math.abs(Math.cos(sp.angle));
    const w = 46;
    const h = Math.max(1.5, 16 * squash);
    ctx.strokeStyle = 'rgba(180,200,240,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-w / 2 - 4, 0);
    ctx.lineTo(w / 2 + 4, 0);
    ctx.stroke();
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, '#fff0c4');
    g.addColorStop(1, '#d98f12');
    ctx.fillStyle = g;
    ctx.strokeStyle = '#2a1a02';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawPlunger(ctx, p, game) {
    const inLaunch = game.state === 'launch';
    ctx.save();
    // Shaft
    ctx.strokeStyle = '#6b7fae';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(500, p.y + 10);
    ctx.lineTo(500, 996);
    ctx.stroke();
    // Head
    const g = ctx.createLinearGradient(0, p.y - 8, 0, p.y + 8);
    g.addColorStop(0, '#e8f1ff');
    g.addColorStop(1, '#7f93c4');
    ctx.fillStyle = g;
    ctx.fillRect(p.x1, p.y - 7, p.x2 - p.x1, 14);
    ctx.strokeStyle = '#17203f';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x1, p.y - 7, p.x2 - p.x1, 14);

    // Charge meter up the side of the chute while you hold it.
    if (inLaunch && p.pull > 0.01) {
      const h = 300 * p.pull;
      const grad = ctx.createLinearGradient(0, 900, 0, 600);
      grad.addColorStop(0, '#8cff4a');
      grad.addColorStop(1, '#ff2e88');
      ctx.fillStyle = grad;
      ctx.fillRect(522, 900 - h, 6, h);
    }
    ctx.restore();
  }

  drawFlippers(ctx, t) {
    for (const f of t.flippers) {
      const tipX = f.px + Math.cos(f.angle) * f.len;
      const tipY = f.py + Math.sin(f.angle) * f.len;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#22060e';
      ctx.lineWidth = (f.r + 3) * 2;
      ctx.beginPath();
      ctx.moveTo(f.px, f.py);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      const g = ctx.createLinearGradient(f.px, f.py, tipX, tipY);
      g.addColorStop(0, '#ff6a7f');
      g.addColorStop(0.5, '#ff2e55');
      g.addColorStop(1, '#b50f33');
      ctx.strokeStyle = g;
      ctx.lineWidth = f.r * 2;
      ctx.beginPath();
      ctx.moveTo(f.px, f.py);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      // Highlight along the top edge
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(f.px, f.py - f.r * 0.45);
      ctx.lineTo(tipX, tipY - f.r * 0.45);
      ctx.stroke();

      // Pivot
      ctx.beginPath();
      ctx.arc(f.px, f.py, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#d7e3ff';
      ctx.fill();
      ctx.restore();
    }
  }

  drawFlashes(ctx, game) {
    if (this.quality !== 'high') return;
    for (const f of game.flashes) {
      const a = f.life / 0.35;
      ctx.save();
      ctx.globalAlpha = a * 0.6;
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * (2 - a));
      g.addColorStop(0, f.color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (2 - a), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawBalls(ctx, game) {
    for (const b of game.balls) {
      // Motion trail
      if (this.quality === 'high') {
        for (let i = 0; i < b.trail.length; i++) {
          const p = b.trail[i];
          const f = i / b.trail.length;
          ctx.fillStyle = `rgba(190,225,255,${f * f * 0.22})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, BALL_R * (0.25 + f * 0.55), 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (b.captured) {
        ctx.save();
        ctx.globalAlpha = 0.55;
      }
      ctx.save();
      if (this.quality === 'high') {
        ctx.shadowColor = 'rgba(190,220,255,0.9)';
        ctx.shadowBlur = 14;
      }
      const g = ctx.createRadialGradient(b.x - 4, b.y - 5, 1, b.x, b.y, BALL_R);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, '#cfdcf2');
      g.addColorStop(0.75, '#7d8ead');
      g.addColorStop(1, '#2a3450');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Specular pin-prick
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(b.x - 3.5, b.y - 4.5, 2.1, 0, Math.PI * 2);
      ctx.fill();
      if (b.captured) ctx.restore();
    }
  }

  drawPopups(ctx, game) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `15px ${MONO}`;
    for (const q of game.popups) {
      const a = Math.min(1, q.life / 0.4);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.strokeStyle = `rgba(0,0,0,${a * 0.8})`;
      ctx.lineWidth = 3;
      ctx.strokeText(q.text, q.x, q.y);
      ctx.fillText(q.text, q.x, q.y);
    }
  }
}
