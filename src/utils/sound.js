/**
 * Optional ambient sound (off by default, enabled in Settings). A soft,
 * short sine tone per pulse; the AudioContext is created only after the
 * visitor turns sound on.
 */
let ctx = null;
let lastAt = 0;

const NOTES = { spark: 660, spiral: 523.25, ripple: 440, bloom: 392, filament: 784 };

export function playPulse(pattern = 'spark', intensity = 0.6) {
  try {
    const now = performance.now();
    if (now - lastAt < 250) return;
    lastAt = now;
    ctx = ctx ?? new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = NOTES[pattern] ?? 523.25;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.04 + intensity * 0.05, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 1.5);
  } catch {
    // Audio is optional.
  }
}
