/**
 * Minimal 2D pinball physics: a circle (the ball) against static line
 * segments, static circles, and swinging capsule flippers.
 *
 * Everything works in "table units" -- the table is TABLE_W x TABLE_H units
 * and the renderer scales that to whatever the screen is. y grows downward,
 * so a positive angle points down-right.
 */

export const TABLE_W = 560;
export const TABLE_H = 1000;

export const BALL_R = 11;
export const GRAVITY = 1520;
export const MAX_SPEED = 2400;
export const LINEAR_DAMPING = 0.14;

/** Below this normal speed a bounce is killed, so balls settle instead of buzzing. */
const REST_CUTOFF = 26;

export function makeBall(x, y, vx = 0, vy = 0) {
  return {
    x, y, vx, vy,
    r: BALL_R,
    trail: [],
    stuckFor: 0,
    captured: null, // set while a saucer/hole is holding the ball
  };
}

export function speedOf(b) {
  return Math.hypot(b.vx, b.vy);
}

export function clampSpeed(b) {
  const s = speedOf(b);
  if (s > MAX_SPEED) {
    const k = MAX_SPEED / s;
    b.vx *= k;
    b.vy *= k;
  }
}

/** Reflect the ball off a surface with the given unit normal. */
function bounce(b, nx, ny, restitution, friction) {
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return 0; // already separating
  const tx = -ny;
  const ty = nx;
  const vt = b.vx * tx + b.vy * ty;
  const rest = Math.abs(vn) < REST_CUTOFF ? 0 : restitution;
  const nvn = -vn * rest;
  const nvt = vt * (1 - friction);
  b.vx = nx * nvn + tx * nvt;
  b.vy = ny * nvn + ty * nvt;
  return -vn; // impact speed, for sound/score strength
}

/**
 * Ball vs. a (possibly thick) line segment.
 * `seg.oneWay` is a unit normal: the ball only collides when travelling
 * against it, which is how the launch-lane gate works.
 */
export function collideSegment(b, seg) {
  const ex = seg.x2 - seg.x1;
  const ey = seg.y2 - seg.y1;
  const len2 = ex * ex + ey * ey;
  let t = len2 > 0 ? ((b.x - seg.x1) * ex + (b.y - seg.y1) * ey) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  const px = seg.x1 + ex * t;
  const py = seg.y1 + ey * t;
  let dx = b.x - px;
  let dy = b.y - py;
  let d = Math.hypot(dx, dy);
  const R = b.r + (seg.r || 0);
  if (d > R) return 0;

  if (d < 1e-6) {
    // Dead centre on the segment: push along its perpendicular.
    const l = Math.hypot(ex, ey) || 1;
    dx = -ey / l;
    dy = ex / l;
    d = 1e-6;
  }
  const nx = dx / d;
  const ny = dy / d;

  if (seg.oneWay) {
    const moving = b.vx * seg.oneWay[0] + b.vy * seg.oneWay[1];
    if (moving > 0) return 0; // travelling the permitted way: pass through
  }

  b.x += nx * (R - d);
  b.y += ny * (R - d);
  const impact = bounce(b, nx, ny, seg.rest ?? 0.36, seg.friction ?? 0.03);

  // Slingshot faces throw the ball back out hard.
  if (seg.kick) {
    b.vx += nx * seg.kick;
    b.vy += ny * seg.kick;
    clampSpeed(b);
    return Math.max(impact, seg.kick);
  }
  return impact;
}

/** Ball vs. a static circle (posts, jet bumpers). */
export function collideCircle(b, c) {
  let dx = b.x - c.x;
  let dy = b.y - c.y;
  let d = Math.hypot(dx, dy);
  const R = b.r + c.r;
  if (d > R) return 0;
  if (d < 1e-6) {
    dx = 0;
    dy = -1;
    d = 1e-6;
  }
  const nx = dx / d;
  const ny = dy / d;
  b.x += nx * (R - d);
  b.y += ny * (R - d);
  const impact = bounce(b, nx, ny, c.rest ?? 0.5, c.friction ?? 0.02);

  // Jet bumpers and slingshots fire the ball away under their own power.
  if (c.kick) {
    b.vx += nx * c.kick;
    b.vy += ny * c.kick;
    clampSpeed(b);
    return Math.max(impact, c.kick);
  }
  return impact;
}

/**
 * Ball vs. flipper, modelled as a capsule rotating about its pivot.
 * The contact point's own velocity is folded in, so a flipper swung into a
 * ball genuinely launches it -- that is where all the game's power comes from.
 */
export function collideFlipper(b, f) {
  const ex = Math.cos(f.angle) * f.len;
  const ey = Math.sin(f.angle) * f.len;
  const len2 = ex * ex + ey * ey;
  let t = ((b.x - f.px) * ex + (b.y - f.py) * ey) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  const cx = f.px + ex * t;
  const cy = f.py + ey * t;
  let dx = b.x - cx;
  let dy = b.y - cy;
  let d = Math.hypot(dx, dy);
  const R = b.r + f.r;
  if (d > R) return 0;
  if (d < 1e-6) {
    dx = 0;
    dy = -1;
    d = 1e-6;
  }
  const nx = dx / d;
  const ny = dy / d;

  b.x += nx * (R - d);
  b.y += ny * (R - d);

  // Velocity of the flipper's surface at the contact point.
  const rx = cx - f.px;
  const ry = cy - f.py;
  const svx = -f.omega * ry;
  const svy = f.omega * rx;

  // Bounce in the flipper's frame of reference, then return to table space.
  b.vx -= svx;
  b.vy -= svy;
  const moving = Math.abs(f.omega) > 0.5;
  const impact = bounce(b, nx, ny, moving ? 0.62 : 0.34, 0.12);
  b.vx += svx;
  b.vy += svy;
  clampSpeed(b);
  return impact;
}

/**
 * Ball against ball, equal masses. Without this, multiball balls occupy the
 * same point -- two of them would stack in the plunger chute at identical
 * coordinates.
 */
export function collideBalls(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const R = a.r + b.r;
  if (d > R) return 0;
  // Exactly coincident: shove them apart on an arbitrary axis.
  const nx = d < 1e-6 ? 1 : dx / d;
  const ny = d < 1e-6 ? 0 : dy / d;
  const push = (R - (d < 1e-6 ? 0 : d)) * 0.5;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;

  const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  if (vn > 0) return 0;
  const j = (-(1 + 0.5) * vn) / 2;
  a.vx -= nx * j;
  a.vy -= ny * j;
  b.vx += nx * j;
  b.vy += ny * j;
  return -vn;
}

/** Integrate one substep of ballistic motion. */
export function integrate(b, h, gravityScale = 1) {
  b.vy += GRAVITY * gravityScale * h;
  const damp = 1 - LINEAR_DAMPING * h;
  b.vx *= damp;
  b.vy *= damp;
  b.x += b.vx * h;
  b.y += b.vy * h;
}
