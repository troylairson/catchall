// Haptics. Android: the Vibration API. iPhone Safari has no Vibration API,
// but tapping a switch-style checkbox (iOS 18+) gives a system haptic tick, so
// a hidden one is clicked. It only fires during a real tap.
let enabled = true;
let label = null;

export function setHapticsEnabled(on) { enabled = on; }

export function initHaptics() {
  if ('vibrate' in navigator) return;
  label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
}

const PATTERNS = { tap: 12, error: [20, 40, 20], win: [15, 60, 15, 60, 30], lose: [40, 60, 40], done: 8 };

export function haptic(kind = 'tap') {
  if (!enabled) return;
  try {
    if ('vibrate' in navigator) navigator.vibrate(PATTERNS[kind] || 10);
    else if (label) {
      label.click();
      if (kind === 'error' || kind === 'win' || kind === 'lose') setTimeout(() => label.click(), 90);
    }
  } catch { /* ignore */ }
}
