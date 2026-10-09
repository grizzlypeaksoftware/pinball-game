/**
 * Boot, resize handling, the render loop, and the HTML HUD.
 */

import { Game, MISSIONS, RANKS } from './game.js';
import { Renderer } from './renderer.js';
import { createInput } from './input.js';
import { initAudio, setMuted, setMusic, audio, suspendAudio, resumeAudio, sfx } from './audio.js';

const $ = (id) => document.getElementById(id);

const stage = $('stage');
const canvas = $('table');
const game = new Game();
const renderer = new Renderer(canvas);
renderer.setTable(game.table);

// Low-end devices get the cheap path: no glow, no trails.
if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) {
  renderer.quality = 'low';
}

// ---- Sizing -----------------------------------------------------------
function fit() {
  const rect = stage.getBoundingClientRect();
  renderer.resize(rect.width, rect.height);
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', () => setTimeout(fit, 250));
if (window.visualViewport) window.visualViewport.addEventListener('resize', fit);

// Canvas text needs the webfonts in place before the static layer is baked.
if (document.fonts?.ready) {
  document.fonts.ready.then(() => {
    renderer.bgDirty = true;
  });
}

// ---- Input ------------------------------------------------------------
const input = createInput(stage, {
  onAnyInput: () => initAudio(),
  onFlip: () => {
    if (game.state === 'play' || game.state === 'launch') sfxFlip();
  },
  onPlungerDown: () => game.plungerDown(),
  onPlungerUp: () => game.plungerRelease(),
  onNudge: () => game.nudge(),
  onPause: () => togglePause(),
  onStart: () => {
    if (game.state === 'attract' || game.state === 'gameOver') startGame();
  },
});

// Only click the flipper coil when a flipper can actually move.
let lastFlipSound = 0;
function sfxFlip() {
  const now = performance.now();
  if (now - lastFlipSound < 40) return;
  lastFlipSound = now;
  sfx.flipper();
}

// ---- Overlays ---------------------------------------------------------
const overlays = {
  title: $('overlay-title'),
  help: $('overlay-help'),
  over: $('overlay-over'),
  pause: $('overlay-pause'),
};

function showOverlay(name) {
  for (const [key, el] of Object.entries(overlays)) {
    el.classList.toggle('d-none', key !== name);
  }
  stage.classList.toggle('overlaid', !!name);
}

function startGame() {
  initAudio();
  showOverlay(null);
  game.startGame();
}

function togglePause() {
  if (game.state === 'attract' || game.state === 'gameOver') return;
  game.togglePause();
  showOverlay(game.state === 'paused' ? 'pause' : null);
}

game.onStateChange = (s) => {
  if (s === 'gameOver') {
    $('final-score').textContent = game.score.toLocaleString();
    $('final-rank').textContent = game.rankName;
    $('final-high').textContent = game.highScore.toLocaleString();
    showOverlay('over');
  }
  $('btn-launch').classList.toggle('d-none', s !== 'launch');
  $('btn-nudge').classList.toggle('d-none', s === 'launch');
};

$('btn-start').addEventListener('click', startGame);
$('btn-again').addEventListener('click', startGame);
$('btn-help').addEventListener('click', () => showOverlay('help'));
$('btn-help-close').addEventListener('click', () => showOverlay('title'));
$('btn-resume').addEventListener('click', togglePause);
$('btn-pause').addEventListener('click', togglePause);
$('btn-quit').addEventListener('click', () => {
  game.saveHighScore();
  game.state = 'attract';
  game.balls = [];
  $('high').textContent = game.highScore.toLocaleString();
  showOverlay('title');
});

const btnLaunch = $('btn-launch');
btnLaunch.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  initAudio();
  game.plungerDown();
});
const releaseLaunch = (e) => {
  e.preventDefault();
  game.plungerRelease();
};
btnLaunch.addEventListener('pointerup', releaseLaunch);
btnLaunch.addEventListener('pointerleave', releaseLaunch);
btnLaunch.addEventListener('pointercancel', releaseLaunch);

$('btn-nudge').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  initAudio();
  game.nudge();
});

// ---- Sound toggles ----------------------------------------------------
const btnSound = $('btn-sound');
btnSound.addEventListener('click', () => {
  initAudio();
  setMuted(!audio.muted);
  btnSound.textContent = audio.muted ? '🔇' : '🔊';
  btnSound.setAttribute('aria-label', audio.muted ? 'Unmute' : 'Mute');
});

const btnMusic = $('btn-music');
btnMusic.addEventListener('click', () => {
  initAudio();
  setMusic(!audio.musicOn);
  btnMusic.classList.toggle('opacity-50', !audio.musicOn);
});

// Shake-to-nudge needs an explicit tap on iOS to ask for motion permission.
const btnTilt = $('btn-tilt');
if (!input.motion.supported) {
  btnTilt.classList.add('d-none');
} else {
  btnTilt.addEventListener('click', async () => {
    if (input.motion.enabled) {
      input.motion.disable();
      btnTilt.classList.add('opacity-50');
      return;
    }
    const ok = await input.motion.enable();
    btnTilt.classList.toggle('opacity-50', !ok);
    if (!ok) game.message('MOTION DENIED', 2);
    else game.message('SHAKE TO NUDGE', 2);
  });
  btnTilt.classList.add('opacity-50');
}

// ---- Pause when backgrounded -----------------------------------------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    suspendAudio();
    input.releaseAll();
    if (game.state === 'play' || game.state === 'launch') {
      game.resumeState = game.state;
      game.setState('paused');
      showOverlay('pause');
    }
  } else {
    resumeAudio();
  }
});
window.addEventListener('blur', () => input.releaseAll());

// ---- HUD --------------------------------------------------------------
const hud = {
  score: $('score'),
  ball: $('ball'),
  balls: $('balls-left'),
  rank: $('rank'),
  mult: $('mult'),
  mission: $('mission'),
  bar: $('mission-bar'),
  high: $('high'),
  msg: $('msg'),
  save: $('ball-save'),
  lock: $('lock-badge'),
};
let lastHudScore = -1;
let lastMsgKey = '';

function drawHud() {
  if (game.score !== lastHudScore) {
    hud.score.textContent = game.score.toLocaleString();
    lastHudScore = game.score;
  }
  hud.ball.textContent = game.state === 'attract' ? '–' : String(game.ballNumber);
  hud.balls.textContent = game.state === 'attract' ? '' : '•'.repeat(Math.max(0, Math.min(6, game.ballsLeft - 1)));
  hud.rank.textContent = game.rankName;
  hud.mult.textContent = game.multiplier + 'x';
  hud.high.textContent = game.highScore.toLocaleString();

  const m = game.mission;
  hud.mission.textContent = m.title;
  hud.bar.style.width = Math.round((game.missionProgress / m.goal) * 100) + '%';

  hud.save.classList.toggle('d-none', !(game.ballSave > 0 && game.state === 'play'));

  const showLock = game.locks > 0 && game.state !== 'attract' && game.state !== 'gameOver';
  hud.lock.classList.toggle('d-none', !showLock);
  if (showLock) hud.lock.textContent = `LOCK ${game.locks}/3`;

  // Rebuild the message stack only when the list actually changes. Rewriting
  // innerHTML every frame restarts the CSS entry animation on every frame,
  // which pins the text at the start of the fade and renders it invisible.
  const lines = game.messages.slice(-3);
  const key = lines.map((l) => l.text).join('\u0001');
  if (key !== lastMsgKey) {
    lastMsgKey = key;
    hud.msg.innerHTML = lines.map((l) => `<div class="msg-line">${escapeHtml(l.text)}</div>`).join('');
  }
  const nodes = hud.msg.children;
  for (let i = 0; i < nodes.length && i < lines.length; i++) {
    nodes[i].style.opacity = String(Math.min(1, lines[i].life / 0.45));
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Loop -------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt, input.state);
  renderer.draw(game);
  drawHud();
  requestAnimationFrame(frame);
}

// Handy from the browser console, and used by the smoke test.
window.__pinball = { game, renderer, input };

// ---- Go ---------------------------------------------------------------
fit();
showOverlay('title');
$('high').textContent = game.highScore.toLocaleString();
$('rank-list').textContent = RANKS.join(' › ');
$('mission-list').innerHTML = MISSIONS.map((m) => `<li>${escapeHtml(m.title)} — <span class="text-info">${escapeHtml(m.hint)}</span></li>`).join('');
requestAnimationFrame(frame);
