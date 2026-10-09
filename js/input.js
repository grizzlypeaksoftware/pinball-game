/**
 * Input: multi-touch flipper zones, keyboard, and shake-to-nudge.
 *
 * On a phone the whole lower playfield is one big pair of buttons -- tap the
 * left side for the left flipper, the right side for the right flipper. Both
 * at once works because every pointer is tracked separately.
 */

export function createInput(surface, hooks) {
  const state = {
    left: false,
    right: false,
    plunger: false,
  };

  const pointers = new Map(); // pointerId -> 'left' | 'right' | 'plunger'

  function zoneFor(ev) {
    const rect = surface.getBoundingClientRect();
    const x = (ev.clientX - rect.left) / rect.width;
    return x < 0.5 ? 'left' : 'right';
  }

  function refresh() {
    let left = false;
    let right = false;
    for (const z of pointers.values()) {
      if (z === 'left') left = true;
      if (z === 'right') right = true;
    }
    if (left && !state.left) hooks.onFlip?.('left');
    if (right && !state.right) hooks.onFlip?.('right');
    state.left = left;
    state.right = right;
  }

  /** Buttons and overlay panels keep their native behaviour (taps, scrolling). */
  const isUI = (t) => !!(t && t.closest && t.closest('[data-ui], .overlay'));

  function down(ev) {
    hooks.onAnyInput?.();
    if (isUI(ev.target)) return;
    ev.preventDefault();
    pointers.set(ev.pointerId, zoneFor(ev));
    refresh();
  }

  function up(ev) {
    if (!pointers.has(ev.pointerId)) return;
    ev.preventDefault();
    pointers.delete(ev.pointerId);
    refresh();
  }

  surface.addEventListener('pointerdown', down, { passive: false });
  surface.addEventListener('pointerup', up, { passive: false });
  surface.addEventListener('pointercancel', up, { passive: false });
  surface.addEventListener('pointerleave', up, { passive: false });
  // Belt and braces on iOS: stop double-tap zoom and rubber-band scrolling,
  // but never over a panel the player needs to scroll or a button they tapped.
  surface.addEventListener('touchstart', (e) => { if (!isUI(e.target)) e.preventDefault(); }, { passive: false });
  surface.addEventListener('touchmove', (e) => { if (!isUI(e.target)) e.preventDefault(); }, { passive: false });
  surface.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- Keyboard ------------------------------------------------------
  const keyZone = (code) => {
    if (code === 'ArrowLeft' || code === 'KeyZ' || code === 'KeyA') return 'left';
    if (code === 'ArrowRight' || code === 'Slash' || code === 'KeyL' || code === 'KeyD') return 'right';
    return null;
  };

  window.addEventListener('keydown', (e) => {
    hooks.onAnyInput?.();
    const z = keyZone(e.code);
    if (z) {
      e.preventDefault();
      if (!state[z]) hooks.onFlip?.(z);
      state[z] = true;
      return;
    }
    if (e.code === 'Space' || e.code === 'ArrowDown') {
      e.preventDefault();
      if (!state.plunger) hooks.onPlungerDown?.();
      state.plunger = true;
    } else if (e.code === 'KeyN' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      e.preventDefault();
      hooks.onNudge?.();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      e.preventDefault();
      hooks.onPause?.();
    } else if (e.code === 'Enter') {
      e.preventDefault();
      hooks.onStart?.();
    }
  });

  window.addEventListener('keyup', (e) => {
    const z = keyZone(e.code);
    if (z) {
      state[z] = false;
      return;
    }
    if (e.code === 'Space' || e.code === 'ArrowDown') {
      state.plunger = false;
      hooks.onPlungerUp?.();
    }
  });

  // ---- Shake to nudge ------------------------------------------------
  // iOS 13+ needs an explicit permission prompt, so this is opt-in from a
  // button rather than something we try on load.
  let lastShake = 0;
  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a) return;
    const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
    const now = performance.now();
    if (mag > 22 && now - lastShake > 420) {
      lastShake = now;
      hooks.onNudge?.();
    }
  }

  const motion = {
    supported: typeof DeviceMotionEvent !== 'undefined',
    needsPermission:
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function',
    enabled: false,
    async enable() {
      if (!this.supported) return false;
      if (this.needsPermission) {
        try {
          const res = await DeviceMotionEvent.requestPermission();
          if (res !== 'granted') return false;
        } catch {
          return false;
        }
      }
      window.addEventListener('devicemotion', onMotion);
      this.enabled = true;
      return true;
    },
    disable() {
      window.removeEventListener('devicemotion', onMotion);
      this.enabled = false;
    },
  };

  return { state, motion, releaseAll: () => { pointers.clear(); refresh(); } };
}
