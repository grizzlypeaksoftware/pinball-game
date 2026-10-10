/**
 * Game rules, scoring and the fixed-timestep physics loop.
 *
 * Shape of a game: 3 balls, a mission ladder that promotes you through the
 * ranks from Cadet to Fleet Admiral, a bonus multiplier from the fuel lanes,
 * and a tilt you can shake yourself into if you get greedy.
 */

import {
  BALL_R, clampSpeed, collideBalls, collideCircle, collideFlipper,
  collideSegment, integrate, makeBall, speedOf,
} from './physics.js';
import { createTable, DRAIN_Y, inLaunchLane, inLeftOutlane, PLUNGER_REST, DOME } from './table.js';
import { sfx } from './audio.js';

export const RANKS = [
  'CADET', 'ENSIGN', 'LIEUTENANT', 'CAPTAIN',
  'COMMANDER', 'ADMIRAL', 'FLEET ADMIRAL',
];

/**
 * Missions are data: `on` maps an event name to how much progress it gives,
 * so adding a new objective never means touching the loop.
 */
export const MISSIONS = [
  { id: 'bumpers', title: 'JET BUMPER DRILL', hint: 'HIT THE JET BUMPERS', goal: 12, on: { bumper: 1 } },
  { id: 'targets', title: 'CADET TRAINING', hint: 'CLEAR THE C-A-D-E-T BANK', goal: 5, on: { target: 1 }, reset: 'targets' },
  { id: 'fuel', title: 'REFUEL THE SHIP', hint: 'COMPLETE THE F-U-E-L LANES', goal: 4, on: { lane: 1 }, reset: 'lanes' },
  { id: 'wormhole', title: 'HYPERSPACE JUMP', hint: 'SHOOT THE HYPERSPACE HOLE x2', goal: 2, on: { wormhole: 1 } },
  { id: 'saucer', title: 'ESCAPE THE BLACK HOLE', hint: 'SHOOT THE BLACK HOLE x2', goal: 2, on: { saucer: 1 } },
  { id: 'spinner', title: 'GYROSCOPE TEST', hint: 'RIP THE RIGHT ORBIT SPINNER', goal: 20, on: { spin: 1 } },
  { id: 'multiball', title: 'MULTIBALL MADNESS', hint: 'TWO BALLS - HIT EVERYTHING!', goal: 14, multiball: true,
    on: { bumper: 1, target: 1, lane: 1, sling: 1, spin: 1, wormhole: 2, saucer: 2 } },
];

const SCORES = {
  bumper: 510,
  sling: 120,
  target: 2500,
  bankClear: 25000,
  lane: 1500,
  fuelComplete: 20000,
  spin: 260,
  wormhole: 50000,
  saucer: 35000,
  post: 50,
};

const BALLS_PER_GAME = 3;
/** Black-hole locks needed to start multiball without the mission ladder. */
const LOCKS_FOR_MULTIBALL = 3;
const BALL_SAVE_TIME = 10;
const FLIPPER_UP_SPEED = 33;
const FLIPPER_DOWN_SPEED = 19;
const PLUNGER_CHARGE_TIME = 0.85;
/** Resting y of the plunger head and how far it pulls back. The forward snap
 *  is drawn by the renderer only -- moving the collision surface above rest
 *  punches a resting ball downward. */
const PLUNGER_TOP = 944;
const PLUNGER_PULL = 30;
const TILT_LIMIT = 3;
const HIGH_SCORE_KEY = 'spaceCadetPinball.highScore';

export class Game {
  constructor() {
    this.table = createTable();
    this.balls = [];
    this.state = 'attract'; // attract | launch | play | ballEnd | gameOver | paused
    this.resumeState = 'play';

    this.score = 0;
    this.ballNumber = 1;
    this.ballsLeft = BALLS_PER_GAME;
    this.rank = 0;
    this.missionIndex = 0;
    this.missionProgress = 0;
    this.multiplier = 1;
    this.bonusUnits = 0;
    this.ballSave = 0;
    this.kickbackLit = false;
    this.extraBallAwarded = false;
    this.locks = 0;

    this.tiltMeter = 0;
    this.tilted = false;
    this.nudgeDir = 1;

    this.bankResetTimer = 0;
    this.messages = [];
    this.popups = [];
    this.flashes = [];
    this.shake = 0;

    this.highScore = this.loadHighScore();
    this.onStateChange = null;
  }

  // ---- persistence ---------------------------------------------------
  loadHighScore() {
    try {
      return Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;
    } catch {
      return 0;
    }
  }

  saveHighScore() {
    try {
      if (this.score > this.highScore) {
        this.highScore = this.score;
        localStorage.setItem(HIGH_SCORE_KEY, String(this.score));
      }
    } catch {
      /* private browsing: just keep it in memory */
    }
  }

  // ---- lifecycle -----------------------------------------------------
  startGame() {
    this.score = 0;
    this.ballNumber = 1;
    this.ballsLeft = BALLS_PER_GAME;
    this.rank = 0;
    this.missionIndex = 0;
    this.multiplier = 1;
    this.extraBallAwarded = false;
    this.locks = 0;
    this.table.resetTargets();
    this.table.resetLanes();
    this.startMission(0);
    this.newBall();
    this.message('MISSION: ' + MISSIONS[0].title, 2.4);
    this.message(MISSIONS[0].hint, 2.4);
  }

  newBall() {
    this.balls = [makeBall(PLUNGER_REST.x, PLUNGER_REST.y)];
    this.table.plunger.pull = 0;
    this.table.plunger.anim = 0;
    this.bonusUnits = 0;
    this.ballSave = BALL_SAVE_TIME;
    this.tiltMeter = 0;
    this.tilted = false;
    this.setState('launch');
  }

  setState(s) {
    this.state = s;
    this.onStateChange?.(s);
  }

  togglePause() {
    if (this.state === 'paused') {
      this.setState(this.resumeState);
    } else if (this.state === 'play' || this.state === 'launch') {
      this.resumeState = this.state;
      this.setState('paused');
    }
  }

  // ---- messaging / effects -------------------------------------------
  message(text, life = 2) {
    this.messages.push({ text, life, max: life });
    if (this.messages.length > 4) this.messages.shift();
  }

  popup(x, y, text) {
    this.popups.push({ x, y, text, life: 0.9 });
    if (this.popups.length > 24) this.popups.shift();
  }

  flash(x, y, r, color) {
    this.flashes.push({ x, y, r, color, life: 0.35 });
    if (this.flashes.length > 30) this.flashes.shift();
  }

  // ---- scoring -------------------------------------------------------
  /** All score changes go through here so the attract demo cannot rack up points. */
  addScore(n) {
    if (this.state === 'attract' || this.state === 'gameOver') return 0;
    this.score += n;
    return n;
  }

  award(type, points, x, y, { silent = false } = {}) {
    if (this.state === 'attract' || this.state === 'gameOver') return;
    const total = Math.round(points * this.multiplier);
    this.addScore(total);
    this.bonusUnits += 1;
    if (!silent && points >= 1000) this.popup(x, y, total.toLocaleString());
    this.advanceMission(type);
  }

  startMission(i) {
    this.missionIndex = i % MISSIONS.length;
    this.missionProgress = 0;
    const m = MISSIONS[this.missionIndex];
    if (m.reset === 'targets') this.table.resetTargets();
    if (m.reset === 'lanes') this.table.resetLanes();
    if (m.multiball) this.startMultiball();
  }

  advanceMission(type) {
    const m = MISSIONS[this.missionIndex];
    const inc = m.on[type];
    if (!inc) return;
    this.missionProgress = Math.min(m.goal, this.missionProgress + inc);
    if (this.missionProgress >= m.goal) this.completeMission();
  }

  completeMission() {
    const m = MISSIONS[this.missionIndex];
    const bonus = 100000 * (this.rank + 1);
    this.addScore(bonus);
    this.shake = Math.max(this.shake, 14);
    sfx.rankUp();

    if (this.rank < RANKS.length - 1) {
      this.rank++;
      this.message('MISSION COMPLETE: ' + m.title, 2.6);
      this.message('PROMOTED TO ' + RANKS[this.rank], 3);
    } else {
      this.message('MISSION COMPLETE: ' + m.title, 2.6);
      this.message('FLEET ADMIRAL BONUS!', 3);
    }
    this.message('+' + bonus.toLocaleString(), 2.6);

    if (this.rank >= 4 && !this.extraBallAwarded) {
      this.extraBallAwarded = true;
      this.ballsLeft++;
      this.message('EXTRA BALL!', 3);
      sfx.extraBall();
    }

    const next = (this.missionIndex + 1) % MISSIONS.length;
    this.startMission(next);
    const nm = MISSIONS[this.missionIndex];
    this.message('NEXT: ' + nm.hint, 3.2);
  }

  startMultiball(count = 1) {
    if (this.state === 'attract' || this.state === 'gameOver') return;
    // Drop the extra balls in from the top of the dome, spread apart so they
    // do not spawn on top of each other.
    for (let i = 0; i < count; i++) {
      this.balls.push(makeBall(DOME.x - 120 + i * 70, DOME.y - 150 - i * 40, 180 - i * 90, 240));
    }
    this.ballSave = Math.max(this.ballSave, 6);
    this.message('MULTIBALL!', 3);
    sfx.multiball();
    this.shake = Math.max(this.shake, 12);
  }

  // ---- player actions ------------------------------------------------
  setFlipper(side, held) {
    if (this.tilted) return;
    const f = this.table.flippers.find((x) => x.side === side);
    if (f) f.held = held;
  }

  plungerDown() {
    this.plungerHeld = true;
  }

  plungerRelease() {
    this.plungerHeld = false;
    if (this.state !== 'launch') return;
    const p = this.table.plunger;
    // Fire the lowest ball in the chute: the one actually sitting on the
    // plunger. With two parked, launching the upper one leaves the lower
    // stranded underneath it.
    let ball = null;
    for (const b of this.balls) {
      if (b.captured || !inLaunchLane(b)) continue;
      if (!ball || b.y > ball.y) ball = b;
    }
    if (!ball) return;
    const power = Math.max(0.25, p.pull);
    p.anim = 1;
    p.pull = 0;
    // The plunger head returns to rest the instant pull drops to zero, so lift
    // the ball to sit on it rather than letting the head snap up through it.
    ball.x = PLUNGER_REST.x;
    ball.y = Math.min(ball.y, PLUNGER_TOP - p.r - BALL_R);
    ball.vy = -(1150 + 950 * power);
    ball.vx = 0;
    ball.trail.length = 0;
    sfx.launch();
    this.setState('play');
  }

  nudge() {
    if (this.state !== 'play' || this.tilted) return;
    this.tiltMeter += 1;
    this.nudgeDir *= -1;
    for (const b of this.balls) {
      if (b.captured) continue;
      b.vy -= 160;
      b.vx += 90 * this.nudgeDir;
      clampSpeed(b);
    }
    this.shake = Math.max(this.shake, 7);
    sfx.nudge();
    if (this.tiltMeter >= TILT_LIMIT) {
      this.tilted = true;
      this.message('TILT!', 3);
      sfx.tilt();
      this.shake = 20;
      for (const f of this.table.flippers) f.held = false;
    } else if (this.tiltMeter === TILT_LIMIT - 1) {
      this.message('DANGER - TILT WARNING', 1.6);
    }
  }

  // ---- main update ---------------------------------------------------
  update(dt, input) {
    // A long pause (tab hidden, phone locked) must not teleport the ball.
    dt = Math.min(dt, 1 / 30);

    this.decayEffects(dt);
    if (this.state === 'paused' || this.state === 'gameOver' || this.state === 'attract') {
      this.animateAttract(dt);
      return;
    }

    this.setFlipper('left', input.left);
    this.setFlipper('right', input.right);

    const p = this.table.plunger;
    if (this.state === 'launch') {
      if (input.plunger || this.plungerHeld) {
        const before = p.pull;
        p.pull = Math.min(1, p.pull + dt / PLUNGER_CHARGE_TIME);
        if (before < 0.02 && p.pull >= 0.02) sfx.plungerPull();
      }
    }
    if (p.anim > 0) p.anim = Math.max(0, p.anim - dt * 6);

    if (this.ballSave > 0 && this.state === 'play') {
      this.ballSave = Math.max(0, this.ballSave - dt);
    }
    if (this.tiltMeter > 0 && !this.tilted) {
      this.tiltMeter = Math.max(0, this.tiltMeter - dt * 0.5);
    }
    if (this.bankResetTimer > 0) {
      this.bankResetTimer -= dt;
      if (this.bankResetTimer <= 0) {
        this.table.resetTargets();
        this.message('TARGETS RESET', 1.4);
      }
    }

    this.stepPhysics(dt);
    this.checkReplunge();
    this.updateHoles(dt);
    this.updateSpinner(dt);
    this.checkDrains(dt);
  }

  /**
   * A launch too weak to clear the chute leaves the ball back on the plunger.
   * This must work for ANY number of balls: during multiball two could park
   * in the chute, and requiring exactly one ball meant the plunger never
   * re-armed and the game deadlocked with no way to put a ball back in play.
   */
  checkReplunge() {
    if (this.state !== 'play') return;
    const parked = this.balls.some(
      (b) => !b.captured && inLaunchLane(b) && b.y > 890 && speedOf(b) < 40
    );
    if (parked) this.setState('launch');
  }

  decayEffects(dt) {
    for (const m of this.messages) m.life -= dt;
    this.messages = this.messages.filter((m) => m.life > 0);
    for (const q of this.popups) {
      q.life -= dt;
      q.y -= dt * 38;
    }
    this.popups = this.popups.filter((q) => q.life > 0);
    for (const f of this.flashes) f.life -= dt;
    this.flashes = this.flashes.filter((f) => f.life > 0);
    this.shake = Math.max(0, this.shake - dt * 45);

    for (const b of this.table.bumpers) b.flash = Math.max(0, b.flash - dt * 4);
    for (const s of this.table.slings) s.flash = Math.max(0, s.flash - dt * 5);
    for (const t of this.table.targets) t.flash = Math.max(0, t.flash - dt * 3);
    for (const l of this.table.lanes) l.cooldown = Math.max(0, l.cooldown - dt);
    for (const h of this.table.holes) h.cooldown = Math.max(0, h.cooldown - dt);
  }

  /** Idle animation for the title screen: a ball bouncing around the table. */
  animateAttract(dt) {
    if (this.state !== 'attract') return;
    if (!this.balls.length) {
      this.balls = [makeBall(DOME.x - 100, 300, 240, 120)];
    }
    this.stepPhysics(dt);
    for (const b of this.balls) {
      if (b.y > DRAIN_Y - 200) {
        b.y = 300;
        b.x = 120 + Math.random() * 280;
        b.vx = (Math.random() - 0.5) * 400;
        b.vy = 120;
      }
    }
  }

  stepPhysics(dt) {
    // Substep so nothing can jump through anything else in one step. This has
    // to account for the FLIPPER as well as the ball: a swinging flipper tip
    // covers ~46 units in a 1/60s step, so sizing the substep from ball speed
    // alone let a flipper sweep straight through a resting ball and punch it
    // out the underside, into the drain.
    let fastest = 1;
    for (const b of this.balls) fastest = Math.max(fastest, speedOf(b));
    for (const f of this.table.flippers) {
      const moving = f.held ? f.angle !== f.up : f.angle !== f.rest;
      if (moving) fastest = Math.max(fastest, FLIPPER_UP_SPEED * f.len);
    }
    const steps = Math.max(1, Math.min(64, Math.ceil((dt * fastest) / (BALL_R * 0.45))));
    const h = dt / steps;

    const p = this.table.plunger;
    for (let i = 0; i < steps; i++) {
      p.y = PLUNGER_TOP + p.pull * PLUNGER_PULL;
      this.updateFlippers(h);
      for (let i = 0; i < this.balls.length; i++) {
        for (let j = i + 1; j < this.balls.length; j++) {
          const a = this.balls[i];
          const c = this.balls[j];
          if (!a.captured && !c.captured) collideBalls(a, c);
        }
      }
      for (const b of this.balls) {
        if (b.captured) continue;
        integrate(b, h);
        this.ejectFromSlings(b);
        this.collideBall(b);
        this.checkHoleEntry(b);
        this.checkSpinner(b);
        clampSpeed(b);
      }
    }

    for (const b of this.balls) {
      if (b.captured) continue;
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 9) b.trail.shift();
      // Shake a wedged ball loose rather than making the player wait. Only
      // while actually in play -- a ball parked on the plunger is not stuck.
      if (this.state === 'play' && speedOf(b) < 26) {
        b.stuckFor += dt;
        if (b.stuckFor > 3.2) {
          b.vx += (Math.random() - 0.5) * 420;
          b.vy -= 260;
          b.stuckFor = 0;
        }
      } else {
        b.stuckFor = 0;
      }
    }
  }

  /**
   * If a ball's centre ever ends up inside a slingshot, push it back out of
   * the nearest face. Nothing should get in there, but a ball wedged inside a
   * closed triangle is unrecoverable, so it is worth the handful of dot
   * products to make it impossible.
   */
  ejectFromSlings(b) {
    for (const s of this.table.slings) {
      let inside = true;
      let shallowest = Infinity;
      let face = null;
      for (const e of s.edges) {
        const d = (b.x - e.x1) * e.nx + (b.y - e.y1) * e.ny;
        if (d > 0) { inside = false; break; }
        if (-d < shallowest) { shallowest = -d; face = e; }
      }
      if (inside && face) {
        b.x += face.nx * (shallowest + b.r + 1);
        b.y += face.ny * (shallowest + b.r + 1);
      }
    }
  }

  updateFlippers(h) {
    for (const f of this.table.flippers) {
      const target = f.held ? f.up : f.rest;
      const prev = f.angle;
      const step = (f.held ? FLIPPER_UP_SPEED : FLIPPER_DOWN_SPEED) * h;
      const d = target - f.angle;
      f.angle = Math.abs(d) <= step ? target : f.angle + Math.sign(d) * step;
      f.omega = (f.angle - prev) / h;
    }
  }

  collideBall(b) {
    const t = this.table;
    const lane = inLaunchLane(b);
    const live = this.state === 'play' || this.state === 'launch';

    for (const s of t.segments) {
      const hit = collideSegment(b, s);
      if (!hit) continue;
      if (s.kind === 'sling') {
        const sling = t.slings.find((x) => x.face === s);
        if (sling) {
          sling.flash = 1;
          this.flash((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, 42, '#ff2e88');
        }
        this.award('sling', SCORES.sling, b.x, b.y, { silent: true });
        sfx.sling();
      } else if (hit > 150) {
        sfx.wall(Math.min(1, hit / 900));
      }
    }

    // The plunger is the floor of the launch lane.
    collideSegment(b, { x1: t.plunger.x1, y1: t.plunger.y, x2: t.plunger.x2, y2: t.plunger.y, r: 5, rest: 0.1, friction: 0.4 });

    for (const c of t.circles) {
      const hit = collideCircle(b, c);
      if (!hit) continue;
      if (c.kind === 'bumper') {
        c.flash = 1;
        c.hits++;
        this.flash(c.x, c.y, c.r + 26, '#2ee6ff');
        this.award('bumper', SCORES.bumper, c.x, c.y, { silent: true });
        this.shake = Math.max(this.shake, 4);
        sfx.bumper();
      } else if (hit > 180) {
        this.addScore(SCORES.post);
        sfx.post();
      }
    }

    for (const f of t.flippers) {
      const hit = collideFlipper(b, f);
      if (hit > 300 && Math.abs(f.omega) > 2) this.shake = Math.max(this.shake, 3);
    }

    for (const tg of t.targets) {
      if (tg.down || !live) continue;
      const hit = collideSegment(b, tg);
      if (!hit) continue;
      tg.down = true;
      tg.flash = 1;
      this.flash((tg.x1 + tg.x2) / 2, (tg.y1 + tg.y2) / 2, 30, '#ffc23a');
      this.award('target', SCORES.target, tg.x1, tg.y1);
      sfx.target();
      if (t.targets.every((x) => x.down)) {
        this.addScore(Math.round(SCORES.bankClear * this.multiplier));
        this.message('C-A-D-E-T COMPLETE  +' + SCORES.bankClear.toLocaleString(), 2.2);
        this.kickbackLit = true;
        this.message('KICKBACK LIT', 1.8);
        this.bankResetTimer = 1.6;
        sfx.award();
        this.shake = Math.max(this.shake, 9);
      }
    }

    // Rollover lanes only count once the ball is out of the launch lane.
    if (!lane && live) {
      for (const l of t.lanes) {
        if (l.cooldown > 0) continue;
        if (Math.hypot(b.x - l.x, b.y - l.y) > l.r) continue;
        l.cooldown = 0.6;
        if (!l.lit) {
          l.lit = true;
          this.award('lane', SCORES.lane, l.x, l.y, { silent: true });
          sfx.rollover();
          this.flash(l.x, l.y, 26, '#8cff4a');
          if (t.lanes.every((x) => x.lit)) this.completeFuel();
        } else {
          this.addScore(Math.round(500 * this.multiplier));
          sfx.rollover();
        }
      }
    }

    // Kickback saves a ball from the left outlane once the bank is cleared.
    if (this.kickbackLit && inLeftOutlane(b)) {
      this.kickbackLit = false;
      b.vy = -1500;
      b.vx = 120;
      this.message('KICKBACK!', 1.8);
      sfx.kickout();
      this.shake = Math.max(this.shake, 10);
    }
  }

  completeFuel() {
    this.table.resetLanes();
    this.addScore(Math.round(SCORES.fuelComplete * this.multiplier));
    if (this.multiplier < 5) {
      this.multiplier++;
      this.message('FUEL FULL - BONUS ' + this.multiplier + 'x', 2.6);
    } else {
      this.message('FUEL FULL  +' + SCORES.fuelComplete.toLocaleString(), 2.4);
    }
    sfx.award();
    this.shake = Math.max(this.shake, 9);
  }

  /**
   * Called once per physics substep, not once per frame: at full speed a ball
   * covers 40 units between frames and would hop clean over a 38-unit hole.
   */
  checkHoleEntry(b) {
    for (const h of this.table.holes) {
      if (h.cooldown > 0) continue;
      if (Math.hypot(b.x - h.x, b.y - h.y) > h.r) continue;
      b.captured = { hole: h, timer: h.id === 'wormhole' ? 0.75 : 1.15 };
      b.vx = 0;
      b.vy = 0;
      b.x = h.x;
      b.y = h.y;
      b.trail.length = 0;
      h.cooldown = 2.4;
      this.flash(h.x, h.y, 50, h.id === 'wormhole' ? '#c56bff' : '#ff6a3d');
      sfx.hole();
      if (h.id === 'wormhole') {
        this.award('wormhole', SCORES.wormhole, h.x, h.y);
        this.message('HYPERSPACE!  +' + SCORES.wormhole.toLocaleString(), 2.2);
      } else {
        this.award('saucer', SCORES.saucer, h.x, h.y);
        this.message('BLACK HOLE  +' + SCORES.saucer.toLocaleString(), 2.2);
        // The saucer physically holds the ball, so it doubles as the lock.
        // This is the route to multiball that does not require grinding the
        // whole mission ladder in a single game.
        if (this.balls.length === 1 && this.locks < LOCKS_FOR_MULTIBALL) {
          this.locks++;
          if (this.locks < LOCKS_FOR_MULTIBALL) {
            const left = LOCKS_FOR_MULTIBALL - this.locks;
            this.message(`BALL ${this.locks} LOCKED - ${left} MORE FOR MULTIBALL`, 2.8);
          } else {
            this.message('MULTIBALL READY!', 2.8);
          }
        }
      }
      this.shake = Math.max(this.shake, 11);
      return;
    }
  }

  updateHoles(dt) {
    for (const b of this.balls) {
      if (!b.captured) continue;
      b.captured.timer -= dt;
      if (b.captured.timer > 0) continue;
      const hole = b.captured.hole;
      b.captured = null;
      b.trail.length = 0;
      if (hole.id === 'wormhole') {
        // Spat out above the jet bumpers for a bonus rattle. Dropping it into
        // the orbit instead let one shot rake the whole target bank for free.
        b.x = DOME.x - 32;
        b.y = DOME.y - 20;
        b.vx = (Math.random() - 0.5) * 220;
        b.vy = 210;
      } else {
        b.x = hole.x;
        b.y = hole.y - 4;
        b.vx = 260;
        b.vy = -1180;
        if (this.locks >= LOCKS_FOR_MULTIBALL) {
          this.locks = 0;
          this.startMultiball(2);
        }
      }
      sfx.kickout();
    }
  }

  /** Per-frame: just the cooldown and the spinning animation. */
  updateSpinner(dt) {
    const sp = this.table.spinner;
    sp.cooldown = Math.max(0, sp.cooldown - dt);
    sp.spinVel *= Math.max(0, 1 - dt * 1.6);
    sp.angle += sp.spinVel * dt;
  }

  /**
   * Per substep, for the same reason as the holes: a ball crossing the
   * spinner at 2000 units/s covers 33 units between frames and would hop
   * straight over the sensor. Checked once a frame, only a third of the
   * balls that went up the orbit actually registered.
   */
  checkSpinner(b) {
    const sp = this.table.spinner;
    if (sp.cooldown > 0) return;
    if (Math.hypot(b.x - sp.x, b.y - sp.y) > sp.r) return;
    sp.cooldown = 0.32;
    // A real spinner racks up a count on every pass, scaled by how hard the
    // ball went through it.
    const spins = 2 + Math.floor(speedOf(b) / 300);
    sp.spins += spins;
    sp.spinVel = Math.max(sp.spinVel, 9 + speedOf(b) / 90);
    for (let i = 0; i < spins; i++) this.award('spin', SCORES.spin, sp.x, sp.y, { silent: true });
    sfx.spinner();
  }

  checkDrains(dt) {
    if (this.state === 'gameOver') return;
    const alive = [];
    let drained = 0;
    for (const b of this.balls) {
      if (!b.captured && b.y > DRAIN_Y) {
        drained++;
        continue;
      }
      alive.push(b);
    }
    if (!drained) return;
    this.balls = alive;

    if (this.balls.length > 0) {
      // Multiball: losing one ball is free.
      this.message('BALL DRAINED', 1.2);
      sfx.drain();
      return;
    }

    if (this.ballSave > 0 && !this.tilted) {
      // One save per ball. The timer only ticks during play, so leaving it
      // armed after a save meant a quick drain cost almost nothing and the
      // same ball could be saved over and over -- you could never lose.
      this.ballSave = 0;
      this.message('BALL SAVED', 2);
      sfx.kickout();
      this.balls = [makeBall(PLUNGER_REST.x, PLUNGER_REST.y)];
      this.table.plunger.pull = 0;
      this.setState('launch');
      return;
    }

    sfx.drain();
    this.endBall();
  }

  endBall() {
    const bonus = this.bonusUnits * 1000 * this.multiplier;
    this.addScore(bonus);
    this.ballsLeft--;
    this.message('BONUS ' + bonus.toLocaleString() + ' (' + this.multiplier + 'x)', 2.8);
    this.kickbackLit = false;

    if (this.ballsLeft <= 0) {
      this.saveHighScore();
      this.setState('gameOver');
      this.message('GAME OVER', 4);
      sfx.gameOver();
      return;
    }

    this.ballNumber++;
    this.setState('ballEnd');
    setTimeout(() => {
      if (this.state === 'ballEnd') this.newBall();
    }, 1800);
  }

  // ---- read-only views for the HUD -----------------------------------
  get mission() {
    return MISSIONS[this.missionIndex];
  }

  get rankName() {
    return RANKS[this.rank];
  }
}
