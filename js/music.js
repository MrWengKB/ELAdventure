/*
 * 史诗背景音乐
 * - 如果存在 music/bgm.mp3，则循环播放该文件（可自行放入任何有授权的音乐）。
 * - 否则使用 Web Audio 实时合成的原创配乐（D 小调，弦乐铺底 + 低音 + 战鼓 + 铜管旋律），无版权问题。
 * 浏览器禁止自动播放，所以在玩家第一次点击页面时开始播放。
 */
(function () {
  "use strict";

  const STORAGE_KEY = "cladventure-music-muted";
  const BPM = 76;
  const BEAT = 60 / BPM;
  const BAR = BEAT * 4;

  // 每小节一个和弦（MIDI 音高），共 8 小节循环
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
  // 铜管旋律：[小节内起始拍, 音高, 拍数]，按小节排列；第二遍循环才出现
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
  // 战鼓：小节内的拍位置和力度
  const DRUMS = [[0, 1], [1.5, 0.6], [2, 0.9], [3, 0.6], [3.5, 0.8]];

  const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

  let muted = false;
  try { muted = localStorage.getItem(STORAGE_KEY) === "1"; } catch (e) { /* 忽略 */ }

  let started = false;
  let mode = null;        // "file" | "synth"
  let audioEl = null;
  let ctx = null, master = null, reverb = null, timer = null;
  let nextBarTime = 0, barIndex = 0;

  // ---------- 合成器 ----------

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

  // 弦乐铺底：三个失谐的锯齿波 + 低通，缓起缓收
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

  // 低音八分音符固定音型
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

  // 战鼓：正弦下滑 + 噪声击打
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

  // 铜管：锯齿 + 方波，滤波器随起音打开
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
      [3.25, 3.5, 3.75].forEach(b => drum(t + b * BEAT, 0.7)); // 过门
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

  // ---------- 播放控制 ----------

  function applyMute() {
    if (mode === "file" && audioEl) {
      if (muted) audioEl.pause(); else audioEl.play().catch(() => {});
    } else if (mode === "synth" && ctx) {
      if (muted) ctx.suspend(); else ctx.resume();
      master.gain.value = muted ? 0 : 0.6;
    }
    const btn = document.getElementById("music-toggle");
    if (btn) {
      btn.textContent = muted ? "🔇 音乐：关" : "🔊 音乐：开";
      btn.setAttribute("aria-pressed", String(!muted));
    }
  }

  async function detectMode() {
    try {
      const res = await fetch("music/bgm.mp3", { method: "HEAD" });
      if (res.ok) return "file";
    } catch (e) { /* 没有音乐文件 */ }
    return "synth";
  }

  const modeReady = detectMode().then(m => { mode = m; });

  async function start() {
    if (started) return;
    started = true;
    await modeReady;
    if (mode === "file") {
      audioEl = new Audio("music/bgm.mp3");
      audioEl.loop = true;
      audioEl.volume = 0.5;
    } else {
      startSynth();
    }
    applyMute();
  }

  function toggle() {
    muted = !muted;
    try { localStorage.setItem(STORAGE_KEY, muted ? "1" : "0"); } catch (e) { /* 忽略 */ }
    if (!started) { if (!muted) start(); else applyMute(); return; }
    applyMute();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("music-toggle");
    if (btn) btn.addEventListener("click", e => { e.stopPropagation(); toggle(); });
    applyMute();
  });

  // 第一次点击页面时开始播放（浏览器不允许自动播放）
  document.addEventListener("pointerdown", function first(e) {
    if (e.target && e.target.id === "music-toggle") return;
    document.removeEventListener("pointerdown", first, true);
    if (!muted) start();
  }, true);

  window.CLAMusic = { start, toggle, isMuted: () => muted };
})();
