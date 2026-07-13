// Soft two-note chime for new request flags (WebAudio, no assets).
let ctx;

export function chime() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    for (const [freq, dt] of [[880, 0], [1174.66, 0.14]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + dt);
      gain.gain.exponentialRampToValueAtTime(0.14, t + dt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + dt);
      osc.stop(t + dt + 0.45);
    }
  } catch {
    // audio unavailable (e.g. no user gesture yet) — the board stays silent
  }
}
