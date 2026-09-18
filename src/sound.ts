// WebAudio 合成音效（无需音频素材）
let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noiseBurst(t0: number, dur: number, freq: number, gain: number) {
  const c = ac()!;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = 1.2;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter).connect(g).connect(c.destination);
  src.start(t0);
}

function tone(t0: number, freq: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const c = ac()!;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export function playStone() {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  noiseBurst(t, 0.05, 2600, 0.25);
  tone(t, 210, 0.09, 0.18, "triangle");
}

export function playCapture() {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  noiseBurst(t, 0.09, 1200, 0.3);
  tone(t, 150, 0.14, 0.2, "triangle");
}

export function playSuccess() {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  tone(t, 523, 0.18, 0.16);
  tone(t + 0.12, 659, 0.18, 0.16);
  tone(t + 0.24, 784, 0.28, 0.16);
}

export function playError() {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  tone(t, 220, 0.12, 0.12, "square");
}
