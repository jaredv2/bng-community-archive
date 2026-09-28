// Soft synthesized interface sounds. No audio files, everything is generated
// with oscillators and short envelopes so it stays smooth and small.
const KEY = "archive:sound";
let ctx = null;
let master = null;
let enabled = localStorage.getItem(KEY) !== "off";

export const soundEnabled = () => enabled;

export function setSoundEnabled(value) {
  enabled = value;
  localStorage.setItem(KEY, value ? "on" : "off");
  if (value) ensure();
  if (master && ctx)
    master.gain.setTargetAtTime(value ? LEVEL : 0, ctx.currentTime, 0.02);
}

const LEVEL = 0.16;

function ensure() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return null;
  ctx = new Audio();
  master = ctx.createGain();
  master.gain.value = enabled ? LEVEL : 0;
  // Keeps the top end soft so nothing ever sounds harsh or clicky.
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 2600;
  tone.Q.value = 0.4;
  master.connect(tone).connect(ctx.destination);
  return ctx;
}

// One voice: an oscillator with a fast attack and a long soft tail.
function voice(freq, { type = "sine", at = 0, attack = 0.006, hold = 0, decay = 0.16, gain = 1, glide = 0 } = {}) {
  if (!ctx || !enabled) return;
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * glide), start + decay);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + attack);
  if (hold) env.gain.setValueAtTime(gain, start + attack + hold);
  env.gain.exponentialRampToValueAtTime(0.0001, start + attack + hold + decay);
  osc.connect(env).connect(master);
  osc.start(start);
  osc.stop(start + attack + hold + decay + 0.05);
}

const cues = {
  tap: () => voice(520, { type: "sine", decay: 0.07, gain: 0.5 }),
  nav: () => {
    voice(440, { type: "sine", decay: 0.1, gain: 0.4 });
    voice(660, { type: "sine", at: 0.035, decay: 0.12, gain: 0.28 });
  },
  open: () => {
    voice(330, { type: "sine", decay: 0.13, gain: 0.45 });
    voice(494, { type: "sine", at: 0.04, decay: 0.16, gain: 0.3 });
  },
  close: () => {
    voice(392, { type: "sine", decay: 0.1, gain: 0.32, glide: 0.72 });
  },
  like: () => {
    voice(660, { type: "sine", decay: 0.1, gain: 0.42 });
    voice(880, { type: "sine", at: 0.05, decay: 0.16, gain: 0.32 });
    voice(1320, { type: "sine", at: 0.1, decay: 0.2, gain: 0.16 });
  },
  success: () => {
    voice(523, { type: "sine", decay: 0.16, gain: 0.42 });
    voice(784, { type: "sine", at: 0.07, decay: 0.2, gain: 0.34 });
    voice(1046, { type: "sine", at: 0.14, decay: 0.28, gain: 0.22 });
  },
  error: () => {
    voice(300, { type: "triangle", decay: 0.14, gain: 0.4, glide: 0.7 });
    voice(220, { type: "sine", at: 0.06, decay: 0.18, gain: 0.26, glide: 0.75 });
  },
  tick: () => voice(880, { type: "sine", decay: 0.04, gain: 0.16 }),
  drag: () => voice(600, { type: "sine", decay: 0.05, gain: 0.22, glide: 1.1 }),
  zoom: () => voice(740, { type: "sine", decay: 0.06, gain: 0.2 }),
};

export function play(name) {
  if (!enabled) return;
  const cue = cues[name];
  if (!cue) return;
  if (!ensure()) return;
  if (ctx.state === "suspended") ctx.resume();
  cue();
}

// Browsers only allow audio after a gesture, so unlock on the first one.
for (const type of ["pointerdown", "keydown", "touchstart"]) {
  window.addEventListener(type, () => ensure(), { once: true, passive: true });
}

// Wires a cue onto any element with data-sound, one listener for the document.
export function bindSounds(root = document) {
  root.addEventListener("pointerdown", (event) => {
    const node = event.target.closest?.("[data-sound]");
    if (node) play(node.dataset.sound);
  });
}
