/**
 * All sound is synthesised at runtime -- no audio files to download, which
 * keeps the whole game a couple of hundred KB and lets it work offline.
 */

let ctx = null;
let master = null;
let musicGain = null;
let sfxGain = null;
let noiseBuf = null;

export const audio = {
  ready: false,
  muted: false,
  musicOn: true,
};

/** Must be called from a user gesture -- iOS will not start audio otherwise. */
export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = audio.muted ? 0 : 0.85;
  master.connect(ctx.destination);

  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.9;
  sfxGain.connect(master);

  musicGain = ctx.createGain();
  musicGain.gain.value = audio.musicOn ? 0.17 : 0;
  musicGain.connect(master);

  // One second of white noise, reused for clacks and whooshes.
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  audio.ready = true;
  startMusic();
}

export function setMuted(m) {
  audio.muted = m;
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.85, ctx.currentTime, 0.02);
}

export function setMusic(on) {
  audio.musicOn = on;
  if (musicGain) musicGain.gain.setTargetAtTime(on ? 0.17 : 0, ctx.currentTime, 0.05);
}

function tone({ freq = 440, to = null, dur = 0.12, type = 'square', gain = 0.3, delay = 0, bend = 'exp' }) {
  if (!audio.ready) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  if (to && to !== freq) {
    if (bend === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    else osc.frequency.linearRampToValueAtTime(Math.max(20, to), t0 + dur);
  }
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(sfxGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.08, gain = 0.25, freq = 1800, q = 1, delay = 0, sweepTo = null }) {
  if (!audio.ready) return;
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(freq, t0);
  bp.Q.value = q;
  if (sweepTo) bp.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(sfxGain);
  src.start(t0, Math.random() * 0.5, dur + 0.05);
}

/** Strength is 0..1 and scales volume, so soft taps sound soft. */
export const sfx = {
  flipper() {
    noise({ dur: 0.05, gain: 0.22, freq: 2400, q: 0.8 });
    tone({ freq: 150, to: 90, dur: 0.05, type: 'square', gain: 0.1 });
  },
  wall(strength = 1) {
    if (strength < 0.12) return;
    noise({ dur: 0.04, gain: 0.08 * strength, freq: 900, q: 1.5 });
  },
  bumper() {
    tone({ freq: 420, to: 1100, dur: 0.1, type: 'square', gain: 0.26 });
    tone({ freq: 210, to: 550, dur: 0.12, type: 'triangle', gain: 0.2 });
  },
  sling() {
    tone({ freq: 900, to: 280, dur: 0.1, type: 'sawtooth', gain: 0.2 });
    noise({ dur: 0.06, gain: 0.16, freq: 1600 });
  },
  target() {
    tone({ freq: 1200, dur: 0.06, type: 'square', gain: 0.22 });
    tone({ freq: 1800, dur: 0.05, type: 'square', gain: 0.14, delay: 0.05 });
  },
  rollover() {
    tone({ freq: 1500, to: 2200, dur: 0.07, type: 'sine', gain: 0.2 });
  },
  spinner() {
    tone({ freq: 2000 + Math.random() * 600, dur: 0.025, type: 'square', gain: 0.1 });
  },
  post() {
    noise({ dur: 0.035, gain: 0.12, freq: 3000, q: 2 });
  },
  launch() {
    noise({ dur: 0.3, gain: 0.3, freq: 300, sweepTo: 3000, q: 0.6 });
    tone({ freq: 120, to: 900, dur: 0.3, type: 'sawtooth', gain: 0.16 });
  },
  plungerPull() {
    tone({ freq: 220, to: 160, dur: 0.1, type: 'triangle', gain: 0.1 });
  },
  drain() {
    tone({ freq: 300, to: 55, dur: 0.6, type: 'sawtooth', gain: 0.24 });
    tone({ freq: 150, to: 40, dur: 0.7, type: 'square', gain: 0.14 });
  },
  hole() {
    tone({ freq: 1400, to: 120, dur: 0.45, type: 'sine', gain: 0.26 });
    noise({ dur: 0.4, gain: 0.12, freq: 2200, sweepTo: 200 });
  },
  kickout() {
    tone({ freq: 160, to: 1200, dur: 0.18, type: 'square', gain: 0.22 });
  },
  award() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => tone({ freq: f, dur: 0.11, type: 'square', gain: 0.2, delay: i * 0.055 }));
  },
  rankUp() {
    const notes = [392, 523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => {
      tone({ freq: f, dur: 0.16, type: 'square', gain: 0.22, delay: i * 0.08 });
      tone({ freq: f / 2, dur: 0.16, type: 'triangle', gain: 0.14, delay: i * 0.08 });
    });
  },
  multiball() {
    for (let i = 0; i < 8; i++) {
      tone({ freq: 300 + i * 130, to: 300 + i * 200, dur: 0.1, type: 'sawtooth', gain: 0.18, delay: i * 0.06 });
    }
  },
  tilt() {
    tone({ freq: 90, to: 60, dur: 0.5, type: 'square', gain: 0.3 });
    noise({ dur: 0.4, gain: 0.2, freq: 400, q: 0.5 });
  },
  nudge() {
    noise({ dur: 0.1, gain: 0.18, freq: 220, q: 0.7 });
  },
  gameOver() {
    const notes = [523, 466, 415, 392, 330, 262];
    notes.forEach((f, i) => tone({ freq: f, dur: 0.26, type: 'triangle', gain: 0.22, delay: i * 0.17 }));
  },
  extraBall() {
    for (let i = 0; i < 3; i++) {
      tone({ freq: 880, to: 1760, dur: 0.12, type: 'square', gain: 0.22, delay: i * 0.14 });
    }
  },
};

// ---- Background music ------------------------------------------------
// A slow 16-step bass sequence with an arpeggio on top: enough to feel like
// a 90s shareware game without ever repeating too obviously.
let musicTimer = null;
let step = 0;

const BASS = [55, 55, 82.4, 55, 73.4, 55, 61.7, 55];
const ARP = [220, 329.6, 261.6, 392, 293.7, 440, 261.6, 329.6];

function startMusic() {
  if (musicTimer || !audio.ready) return;
  const stepDur = 0.26;
  const tick = () => {
    const t0 = ctx.currentTime;
    const i = step % 8;

    const b = ctx.createOscillator();
    const bg = ctx.createGain();
    b.type = 'triangle';
    b.frequency.value = BASS[i];
    bg.gain.setValueAtTime(0.0001, t0);
    bg.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + stepDur * 0.9);
    b.connect(bg).connect(musicGain);
    b.start(t0);
    b.stop(t0 + stepDur);

    if (step % 2 === 0) {
      const a = ctx.createOscillator();
      const ag = ctx.createGain();
      a.type = 'square';
      a.frequency.value = ARP[(step / 2) % 8];
      ag.gain.setValueAtTime(0.0001, t0);
      ag.gain.exponentialRampToValueAtTime(0.1, t0 + 0.01);
      ag.gain.exponentialRampToValueAtTime(0.0001, t0 + stepDur * 0.7);
      a.connect(ag).connect(musicGain);
      a.start(t0);
      a.stop(t0 + stepDur);
    }
    step++;
  };
  tick();
  musicTimer = setInterval(tick, 260);
}

export function suspendAudio() {
  if (ctx && ctx.state === 'running') ctx.suspend();
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
