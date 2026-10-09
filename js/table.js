/**
 * Table layout. Pure geometry + element state -- no physics, no rules.
 *
 * The playfield interior spans x 28..468 and mirrors about x = 248
 * (MIRROR - x). To the right of x = 468 is the launch lane, and the whole
 * top is one big dome the launched ball orbits around.
 *
 * Lane widths below are all checked against the 22-unit ball diameter: the
 * outlane mouths let a ball through, the inlane-to-flipper gaps do not.
 */

import { BALL_R } from './physics.js';

const MIRROR = 496;
export const DOME = { x: 280, y: 340, r: 252 };
/** Inner wall of the orbit channel; the gap to DOME.r is the lane width. */
export const ORBIT_INNER_R = 196;
export const DRAIN_Y = 992;
export const LANE_X = 468;
export const PLUNGER_REST = { x: 500, y: 930 };

const mx = (x) => MIRROR - x;

function wall(x1, y1, x2, y2, opts = {}) {
  return { x1, y1, x2, y2, r: opts.r ?? 5, rest: opts.rest, friction: opts.friction, kick: opts.kick, oneWay: opts.oneWay, kind: opts.kind || 'wall' };
}

/** A wall mirrored to the other half of the table. */
function mirrorWall(w) {
  return { ...w, x1: mx(w.x1), x2: mx(w.x2), oneWay: w.oneWay ? [-w.oneWay[0], w.oneWay[1]] : undefined };
}

/** Approximate an arc with line segments. */
function arc(cx, cy, r, a1, a2, steps, opts = {}) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t1 = a1 + ((a2 - a1) * i) / steps;
    const t2 = a1 + ((a2 - a1) * (i + 1)) / steps;
    out.push(
      wall(cx + Math.cos(t1) * r, cy - Math.sin(t1) * r, cx + Math.cos(t2) * r, cy - Math.sin(t2) * r, opts)
    );
  }
  return out;
}

const polar = (a, r) => ({ x: DOME.x + Math.cos(a) * r, y: DOME.y - Math.sin(a) * r });
const deg = (d) => (d * Math.PI) / 180;

export function createTable() {
  const segments = [];
  const circles = [];

  // ---- Outer boundary ------------------------------------------------
  segments.push(wall(28, 340, 28, 700, { kind: 'rail' })); // left wall
  segments.push(wall(28, 700, 44, 790, { kind: 'rail' })); // bends in toward the outlane
  segments.push(...arc(DOME.x, DOME.y, DOME.r, deg(180), deg(0), 36, { kind: 'dome', rest: 0.3 }));
  segments.push(wall(532, 340, 532, 1000, { kind: 'rail' })); // right wall / launch lane outer
  segments.push(wall(LANE_X, 300, LANE_X, 1000, { kind: 'rail' })); // launch lane divider

  // Right-hand playfield edge mirrors the left wall's inward bend.
  segments.push(wall(mx(28), 700, mx(44), 790, { kind: 'rail' }));

  // Return guides. A ball coming out of the orbit falls straight down the
  // side wall and into the outlane every single time, which is a cheap
  // drain; these catch it at a shallow angle and feed it to the inlane
  // instead. The outlane stays reachable through the gap below each guide.
  segments.push(wall(28, 470, 104, 740, { kind: 'guide', r: 6 }));
  // The right-hand guide sits across the mouth of the orbit, so it is a
  // one-way: a ball driven up and to the right passes into the orbit lane,
  // while anything coming back down is caught and fed to the inlane.
  segments.push(wall(LANE_X, 560, 392, 745, { kind: 'guide', r: 6, oneWay: [0.5, -0.866] }));

  // No gate across the chute mouth on purpose: a one-way flap there is a
  // near-horizontal ledge a weak launch can come to rest on, and the ball
  // wedges against the dome with nowhere to roll. Letting a ball fall back
  // into the chute is self-correcting instead -- the game spots it sitting on
  // the plunger and hands the player another launch.

  // ---- Bottom: outlanes, inlanes, slingshots -------------------------
  const outlaneOuter = wall(44, 790, 70, 952, { kind: 'rail' });
  // The inlane rail flattens out at the bottom to roughly the flipper's own
  // resting angle. A single steep rail meeting the flipper head-on forms a
  // V-shaped pocket that traps the ball against the pivot forever.
  const inlaneRailA = wall(76, 790, 112, 846, { kind: 'rail' });
  const inlaneRailB = wall(112, 846, 150, 868, { kind: 'rail' });
  segments.push(outlaneOuter, mirrorWall(outlaneOuter));
  segments.push(inlaneRailA, mirrorWall(inlaneRailA));
  segments.push(inlaneRailB, mirrorWall(inlaneRailB));

  // Splitter posts decide outlane (drain) vs. inlane (back to the flipper).
  circles.push({ x: 80, y: 778, r: 9, rest: 0.7, kind: 'post' });
  circles.push({ x: mx(80), y: 778, r: 9, rest: 0.7, kind: 'post' });

  // Slingshots: triangles whose inner face kicks hard.
  const slings = [];
  for (const side of [1, -1]) {
    const f = (x) => (side === 1 ? x : mx(x));
    const a = { x: f(142), y: 752 };
    const b = { x: f(214), y: 832 };
    const c = { x: f(146), y: 826 };
    const face = wall(a.x, a.y, b.x, b.y, { kind: 'sling', r: 6, rest: 0.55, kick: 540 });
    segments.push(face);
    segments.push(wall(b.x, b.y, c.x, c.y, { kind: 'slingBack', r: 4 }));
    segments.push(wall(c.x, c.y, a.x, a.y, { kind: 'slingBack', r: 4 }));
    slings.push({ side, a, b, c, face, flash: 0 });
  }

  // ---- Flippers ------------------------------------------------------
  const flippers = [
    { side: 'left', px: 150, py: 886, len: 84, r: 9, rest: 0.4, up: -0.52, angle: 0.4, omega: 0, held: false },
    { side: 'right', px: mx(150), py: 886, len: 84, r: 9, rest: Math.PI - 0.4, up: Math.PI + 0.52, angle: Math.PI - 0.4, omega: 0, held: false },
  ];

  // ---- Jet bumpers ---------------------------------------------------
  // Tight enough that a ball entering the nest rattles between all three.
  const bumpers = [
    { x: 182, y: 462, r: 25 },
    { x: 248, y: 410, r: 25 },
    { x: 314, y: 462, r: 25 },
  ].map((b, i) => ({ ...b, id: i, rest: 0.55, kick: 470, kind: 'bumper', flash: 0, hits: 0 }));
  circles.push(...bumpers);

  // ---- Standing posts ------------------------------------------------
  for (const p of [
    { x: 190, y: 700, r: 9 },
    { x: mx(190), y: 700, r: 9 },
  ]) {
    circles.push({ ...p, rest: 0.78, kind: 'post' });
  }

  // ---- Orbit channel -------------------------------------------------
  // An inner guide arc turns the dome into a 56-wide channel. Without it a
  // launched ball just ricochets off the dome into open space and lobs back
  // down the chute; with it, both the plunger and the right orbit feed a real
  // loop that carries the ball over the top and down the left side.
  segments.push(...arc(DOME.x, DOME.y, ORBIT_INNER_R, deg(30), deg(160), 26, { kind: 'dome', rest: 0.3 }));

  // ---- Right orbit + spinner ----------------------------------------
  // The orbit's inner wall runs from the bottom of that arc down the right
  // side, keeping the lane 33-50 units wide the whole way.
  const orbitTop = polar(deg(30), ORBIT_INNER_R);
  segments.push(wall(orbitTop.x, orbitTop.y, 420, 360, { kind: 'rail' }));
  segments.push(wall(420, 360, 418, 540, { kind: 'rail' }));
  // The spinner lives in the orbit channel itself, at the top of the right
  // orbit. Down in the orbit lane it saw almost no traffic: a flipper shot
  // cannot thread that lane (a parabola only flattens as it climbs), so the
  // only balls passing it were rare precise loops.
  const spinnerPos = polar(deg(36), 224);
  const spinner = { x: spinnerPos.x, y: spinnerPos.y, r: 30, a: deg(36), angle: 0, spinVel: 0, cooldown: 0, spins: 0 };

  // ---- Drop target bank: C-A-D-E-T ----------------------------------
  // One straight bank in the upper left, faces pointing down-right.
  const bankA = { x: 88, y: 566 };
  const bankB = { x: 176, y: 504 };
  const bankLen = Math.hypot(bankB.x - bankA.x, bankB.y - bankA.y);
  const ux = (bankB.x - bankA.x) / bankLen;
  const uy = (bankB.y - bankA.y) / bankLen;
  const letters = ['C', 'A', 'D', 'E', 'T'];
  const tLen = 20;
  const tGap = (bankLen - letters.length * tLen) / (letters.length - 1);
  const targets = letters.map((letter, i) => {
    const s = i * (tLen + tGap);
    return {
      letter,
      id: i,
      x1: bankA.x + ux * s,
      y1: bankA.y + uy * s,
      x2: bankA.x + ux * (s + tLen),
      y2: bankA.y + uy * (s + tLen),
      r: 5,
      rest: 0.3,
      kind: 'target',
      down: false,
      flash: 0,
    };
  });

  // ---- Fuel lanes ("F U E L") ---------------------------------------
  // Four rollovers spaced around the orbit channel. A clean loop lights all
  // four, so completing F-U-E-L is the reward for a full orbit.
  const lanes = [
    { letter: 'F', a: 124 },
    { letter: 'U', a: 100 },
    { letter: 'E', a: 76 },
    { letter: 'L', a: 52 },
  ].map((l, i) => {
    const p = polar(deg(l.a), 230);
    return { ...l, id: i, x: p.x, y: p.y, r: 22, lit: false, cooldown: 0 };
  });

  // ---- Holes ---------------------------------------------------------
  const holes = [
    { id: 'wormhole', label: 'HYPERSPACE', x: 386, y: 600, r: 19, cooldown: 0 },
    { id: 'saucer', label: 'BLACK HOLE', x: 150, y: 290, r: 19, cooldown: 0 },
  ];

  // ---- Plunger -------------------------------------------------------
  const plunger = { x1: 470, x2: 530, y: 944, pull: 0, anim: 0, r: 5, rest: 0.1, kind: 'plunger' };

  return {
    segments,
    circles,
    flippers,
    bumpers,
    slings,
    targets,
    lanes,
    holes,
    spinner,
    plunger,
    bank: { a: bankA, b: bankB },
    /** Rebuild the drop-target bank after it has been cleared. */
    resetTargets() {
      for (const t of this.targets) t.down = false;
    },
    resetLanes() {
      for (const l of this.lanes) l.lit = false;
    },
  };
}

/** True when the ball sits in the launch lane rather than on the playfield. */
export function inLaunchLane(b) {
  return b.x > LANE_X + BALL_R * 0.5 && b.y > 320;
}

/** True when a ball has fallen into the left outlane (for the kickback). */
export function inLeftOutlane(b) {
  return b.x < 95 && b.y > 820 && b.y < DRAIN_Y;
}
