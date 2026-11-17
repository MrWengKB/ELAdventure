/*
 * Epic background music
 * - If music/bgm.mp3 exists, it is looped (drop in any properly licensed track).
 * - Otherwise an original score is synthesized live with Web Audio (D minor: string pad + bass + war drums + brass melody), so there are no copyright issues.
 * Tries to autoplay on page load; if the browser blocks autoplay, playback starts on the player's first interaction of any kind (click, touch or key press).
 */
(function () {
  "use strict";

  const STORAGE_KEY = "cladventure-music-muted";
  const BPM = 76;
  const BEAT = 60 / BPM;
  const BAR = BEAT * 4;

  // One chord per bar (MIDI pitches), looping over 8 bars
  const CHORDS = [
    [50, 53, 57], // Dm
    [46, 50, 53], // Bb
    [41, 45, 48], // F
    [48, 52, 55], // C
    [50, 53, 57], // Dm
    [46, 50, 53], // Bb
    [43, 46, 50], // Gm
    [45, 49, 52], // A
  ];
  // Brass melody: [start beat in bar, pitch, beats], grouped by bar; only enters on the second pass
  const MELODY = [
    [[0, 62, 1.5], [1.5, 65, 0.5], [2, 69, 2]],
    [[0, 70, 2], [2, 69, 1], [3, 65, 1]],
    [[0, 65, 1.5], [1.5, 69, 0.5], [2, 72, 2]],
    [[0, 72, 1], [1, 70, 1], [2, 67, 2]],
    [[0, 69, 1.5], [1.5, 74, 0.5], [2, 74, 2]],
    [[0, 74, 1], [1, 72, 1], [2, 70, 2]],
    [[0, 70, 1], [1, 69, 1], [2, 67, 1], [3, 70, 1]],
    [[0, 69, 3], [3, 61, 1]],
  ];
  // War drums: beat positions within the bar and velocity
  const DRUMS = [[0, 1], [1.5, 0.6], [2, 0.9], [3, 0.6], [3.5, 0.8]];

  const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

  let muted = false;
  try { muted = localStorage.getItem(STORAGE_KEY) === "1"; } catch (e) { /* ignore */ }

  let mode = null;        // "file" | "synth"
  let audioEl = null;
  let ctx = null, master = null, reverb = null, timer = null;
  let nextBarTime = 0, barIndex = 0;

  // ---------- Synthesizers ----------

  function makeReverb() {
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  function out(node, wet) {
    node.connect(master);
    const send = ctx.createGain();
    send.gain.value = wet;
    node.connect(send);
    send.connect(reverb);
  }

  // String pad: three detuned sawtooth waves + low-pass, slow attack and release
  function pad(freq, t, dur, vol) {
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 1100; f.Q.value = 0.5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.8);
    g.gain.setValueAtTime(vol, t + dur - 0.4);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.3);
    [-7, 0, 7].forEach(det => {
      const o = ctx.createOscillator();
      o.type = "sawtooth"; o.frequency.value = freq; o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.4);
    });
    f.connect(g); out(g, 0.5);
  }

  // Bass ostinato in eighth notes
  function bass(freq, t, dur, vol) {
    const o = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "sawtooth"; o.frequency.value = freq;
    f.type = "lowpass"; f.frequency.value = 380;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); f.connect(g); out(g, 0.15);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // War drum: falling sine + noise hit
  function drum(t, vel) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.35);
    g.gain.setValueAtTime(0.9 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g); out(g, 0.35);
    o.start(t); o.stop(t + 0.65);

    const n = ctx.createBufferSource();
    const nb = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = nb;
    const nf = ctx.createBiquadFilter();
    nf.type = "lowpass"; nf.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    n.connect(nf); nf.connect(ng); out(ng, 0.3);
    n.start(t);
  }

  // Brass: sawtooth + square, filter opens with the attack
  function brass(freq, t, dur, vol) {
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.Q.value = 2;
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(2200, t + 0.12);
    f.frequency.linearRampToValueAtTime(1400, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.06);
    g.gain.setValueAtTime(vol, t + Math.max(0.07, dur - 0.08));
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    ["sawtooth", "square"].forEach((type, i) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = freq; o.detune.value = i ? 5 : -5;
      o.connect(f); o.start(t); o.stop(t + dur + 0.1);
    });
    f.connect(g); out(g, 0.45);
  }

  function scheduleBar(t, idx) {
    const bar = idx % CHORDS.length;
    const loop = Math.floor(idx / CHORDS.length);
    const chord = CHORDS[bar];

    chord.forEach(m => pad(midiToFreq(m), t, BAR, 0.035));
    pad(midiToFreq(chord[0] + 12), t, BAR, 0.02);

    for (let i = 0; i < 8; i++) {
      bass(midiToFreq(chord[0] - 12), t + i * BEAT / 2, BEAT / 2, i % 2 ? 0.12 : 0.18);
    }
    DRUMS.forEach(([beat, vel]) => drum(t + beat * BEAT, vel));
    if (bar === CHORDS.length - 1) {
      [3.25, 3.5, 3.75].forEach(b => drum(t + b * BEAT, 0.7)); // fill
    }
    if (loop % 2 === 1) {
      MELODY[bar].forEach(([beat, m, len]) => brass(midiToFreq(m), t + beat * BEAT, len * BEAT, 0.06));
    }
  }

  function scheduler() {
    while (nextBarTime < ctx.currentTime + 0.6) {
      scheduleBar(nextBarTime, barIndex++);
      nextBarTime += BAR;
    }
  }

  function startSynth() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.6;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
    reverb = makeReverb();
    reverb.connect(master);
    nextBarTime = ctx.currentTime + 0.1;
    barIndex = 0;
    scheduler();
    timer = setInterval(scheduler, 200);
  }

  // ---------- Playback control ----------

  const INTERACTION_EVENTS = ["pointerdown", "touchstart", "keydown", "click"];

  function updateButton() {
    const btn = document.getElementById("music-toggle");
    if (btn) {
      btn.textContent = muted ? "🔇 Music: Off" : "🔊 Music: On";
      btn.setAttribute("aria-pressed", String(!muted));
    }
  }

  async function detectMode() {
    try {
      const res = await fetch("music/bgm.mp3", { method: "HEAD" });
      if (res.ok) return "file";
    } catch (e) { /* no music file */ }
    return "synth";
  }

  const modeReady = detectMode().then(m => {
    mode = m;
    if (mode === "file") {
      audioEl = new Audio("music/bgm.mp3");
      audioEl.loop = true;
      audioEl.volume = 0.5;
      audioEl.preload = "auto";
    }
  });

  function isPlaying() {
    if (mode === "file") return !!audioEl && !audioEl.paused;
    return !!ctx && ctx.state === "running";
  }

  /** Try to play; resolves true if playing, false if the browser blocked it */
  function play() {
    if (muted) return Promise.resolve(false);
    if (!mode) return modeReady.then(play);
    if (mode === "file") {
      return audioEl.play().then(() => true, () => false);
    }
    if (!ctx) startSynth();
    if (!ctx) return Promise.resolve(false);
    master.gain.value = 0.6;
    const resumed = ctx.resume().catch(() => {});
    const wait = new Promise(r => setTimeout(r, 300));
    return Promise.race([resumed, wait]).then(() => ctx.state === "running");
  }

  function pause() {
    if (audioEl) audioEl.pause();
    if (ctx) ctx.suspend();
  }

  function removeInteractionListeners() {
    INTERACTION_EVENTS.forEach(t => document.removeEventListener(t, onInteraction, true));
  }

  // The first interaction of any kind (click, touch or key press) starts playback
  function onInteraction(e) {
    if (e.target && e.target.id === "music-toggle") return;
    if (muted) return;
    if (isPlaying()) { removeInteractionListeners(); return; }
    play().then(ok => { if (ok) removeInteractionListeners(); });
  }

  function toggle() {
    muted = !muted;
    try { localStorage.setItem(STORAGE_KEY, muted ? "1" : "0"); } catch (e) { /* ignore */ }
    updateButton();
    if (muted) pause();
    else play().then(ok => { if (ok) removeInteractionListeners(); });
  }

  INTERACTION_EVENTS.forEach(t => document.addEventListener(t, onInteraction, true));

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("music-toggle");
    if (btn) btn.addEventListener("click", e => { e.stopPropagation(); toggle(); });
    updateButton();
    // Try to play as soon as the page loads; if the browser blocks it, wait for the first interaction
    play().then(ok => { if (ok) removeInteractionListeners(); });
  });

  window.CLAMusic = { play, toggle, isPlaying, isMuted: () => muted };
})();
