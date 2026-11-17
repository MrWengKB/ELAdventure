/* Text Adventure: game logic */
(function () {
  "use strict";

  const MAX_LIFE = 10;
  const START_COINS = 200;
  const MAX_DAYS = 30;

  // ---------- Pure logic (testable on its own) ----------

  /** Parse CSV text (handles BOM, quotes and escaped commas) into an array of objects */
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        rows.push(row); row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }

    const nonEmpty = rows.filter(r => r.some(f => f.trim() !== ""));
    if (!nonEmpty.length) return [];
    const header = nonEmpty[0].map(h => h.trim());
    return nonEmpty.slice(1).map(r => {
      const obj = {};
      header.forEach((h, idx) => { obj[h] = (r[idx] || "").trim(); });
      return obj;
    });
  }

  function createState() {
    return { day: 0, life: MAX_LIFE, coins: START_COINS, exp: 0, over: false, won: false };
  }

  /**
   * Apply an event to the state; returns the new state and the actual changes.
   * - life: a number is a change, "full" restores to max; never above max or below 0
   * - coins: may go negative (debt)
   * - exp: only increases (negative values count as 0)
   */
  function applyEvent(state, event) {
    const s = Object.assign({}, state);
    const lifeRaw = String(event.life ?? "0").trim().toLowerCase();
    if (lifeRaw === "full") {
      s.life = MAX_LIFE;
    } else {
      const d = parseInt(lifeRaw, 10) || 0;
      s.life = Math.min(MAX_LIFE, Math.max(0, s.life + d));
    }
    s.coins += parseInt(event.coins, 10) || 0;
    s.exp += Math.max(0, parseInt(event.exp, 10) || 0);
    return {
      state: s,
      delta: { life: s.life - state.life, coins: s.coins - state.coins, exp: s.exp - state.exp },
    };
  }

  /** Start a new day and resolve its event */
  function advanceDay(state, event) {
    const { state: s, delta } = applyEvent(Object.assign({}, state, { day: state.day + 1 }), event);
    if (s.life <= 0) { s.over = true; s.won = false; }
    else if (s.day >= MAX_DAYS) { s.over = true; s.won = true; }
    return { state: s, delta };
  }

  /**
   * Penalty for consecutive wrong answers (streak = wrong answers in a row, including this one):
   * 1: no penalty; 2: lose 10 coins; 3: lose 1 life; 4: game over.
   */
  function applyWrongAnswer(state, streak) {
    const s = Object.assign({}, state);
    let penalty = "";
    if (streak === 2) {
      s.coins -= 10;
      penalty = "2 wrong answers in a row: you lose 10 coins.";
    } else if (streak === 3) {
      s.life = Math.max(0, s.life - 1);
      penalty = "3 wrong answers in a row: you lose 1 life.";
    } else if (streak >= 4) {
      s.over = true; s.won = false;
      penalty = "4 wrong answers in a row: your adventure ends here.";
    }
    if (s.life <= 0) { s.over = true; s.won = false; }
    return { state: s, penalty };
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Pick a random element, avoiding a repeat of the last one when possible */
  function pickRandom(list, last) {
    if (list.length <= 1) return list[0];
    let item;
    do { item = list[Math.floor(Math.random() * list.length)]; } while (item === last);
    return item;
  }

  const Logic = { MAX_LIFE, START_COINS, MAX_DAYS, parseCSV, createState, applyEvent, advanceDay, applyWrongAnswer, shuffle, pickRandom };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Logic;
  }
  if (typeof document === "undefined") return;

  // ---------- UI ----------

  const $ = id => document.getElementById(id);
  const panel = $("panel");
  const log = $("log");

  let questions = [];
  let events = [];
  let state = createState();
  let lastQuestion = null;
  let lastEvent = null;
  let wrongStreak = 0;

  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "onclick") e.addEventListener("click", v);
      else e.setAttribute(k, v);
    });
    if (text != null) e.textContent = text;
    return e;
  }

  function signed(n) { return (n > 0 ? "+" : "") + n; }

  function renderStats() {
    $("stat-day").textContent = `${state.day} / ${MAX_DAYS}`;
    $("stat-life").textContent = `${state.life} / ${MAX_LIFE}`;
    $("stat-coins").textContent = state.coins;
    $("stat-coins").classList.toggle("negative", state.coins < 0);
    $("stat-exp").textContent = state.exp;
  }

  function addLog(text) {
    log.insertBefore(el("li", null, text), log.firstChild);
  }

  function showStart() {
    panel.replaceChildren(
      el("p", null, "Welcome to Text Adventure! You start with 10 life and 200 coins. To begin each new day you must answer a question correctly, then face that day's random event. Survive 30 days to win."),
      el("button", { class: "primary", onclick: askQuestion }, "Start Day 1")
    );
  }

  function askQuestion() {
    const q = pickRandom(questions, lastQuestion);
    lastQuestion = q;
    const options = shuffle([q.Answer, q.Distractor1, q.Distractor2, q.Distractor3].filter(Boolean));
    const box = el("div", { class: "options" });
    options.forEach(opt => {
      box.appendChild(el("button", { onclick: () => answer(q, opt, box) }, opt));
    });
    panel.replaceChildren(
      el("p", null, `To start Day ${state.day + 1}, answer this question first:`),
      el("p", { class: "question" }, q.Question),
      box
    );
  }

  function answer(q, chosen, box) {
    const buttons = Array.from(box.querySelectorAll("button"));
    buttons.forEach(b => {
      b.disabled = true;
      if (b.textContent === q.Answer) b.classList.add("correct");
      else if (b.textContent === chosen) b.classList.add("wrong");
    });

    if (chosen === q.Answer) {
      wrongStreak = 0;
      panel.appendChild(el("p", { class: "result-good" }, "Correct! A new day begins."));
      panel.appendChild(el("button", { class: "primary", onclick: startDay }, "Continue"));
    } else {
      wrongStreak++;
      const result = applyWrongAnswer(state, wrongStreak);
      state = result.state;
      renderStats();
      panel.appendChild(el("p", { class: "result-bad" }, `Wrong. The correct answer is: ${q.Answer}.`));
      if (result.penalty) {
        panel.appendChild(el("p", { class: "result-bad" }, result.penalty));
        addLog(`Before Day ${state.day + 1}: ${result.penalty}`);
      } else {
        panel.appendChild(el("p", { class: "changes" }, "No penalty this time, but wrong answers in a row will cost you."));
      }
      if (state.over) {
        lose(state.life <= 0 ? "You ran out of life... " : "You got 4 questions wrong in a row... ");
      } else {
        panel.appendChild(el("button", { class: "primary", onclick: askQuestion }, "Try another question"));
      }
    }
  }

  function startDay() {
    const ev = pickRandom(events, lastEvent);
    lastEvent = ev;
    const result = advanceDay(state, ev);
    state = result.state;
    renderStats();

    const d = result.delta;
    const lifeText = String(ev.life).trim().toLowerCase() === "full" ? `Life fully restored (${signed(d.life)})` : `Life ${signed(d.life)}`;
    const changes = `${lifeText}, Coins ${signed(d.coins)}, EXP ${signed(d.exp)}`;
    addLog(`Day ${state.day}: ${ev.event} (${changes})`);

    const nodes = [
      el("p", null, `Day ${state.day}`),
      el("p", { class: "question" }, ev.event),
      el("p", { class: "changes" }, changes),
    ];

    if (!state.over) {
      nodes.push(el("button", { class: "primary", onclick: askQuestion }, `Start Day ${state.day + 1}`));
    }
    panel.replaceChildren(...nodes);
    if (state.over && state.won) win();
    else if (state.over) lose("You ran out of life... ");
  }

  function finalStats() {
    return `Life ${state.life}, Coins ${state.coins}, EXP ${state.exp}`;
  }

  function win() {
    addLog("You won!");
    endGame(true, "🎉 Congratulations, you won!", `You survived all ${MAX_DAYS} days! Final: ${finalStats()}.`);
  }

  function lose(reason) {
    addLog("Game over.");
    endGame(false, "Game Over", `${reason}You lasted ${state.day} days. Final: ${finalStats()}.`);
  }

  /** Game over: leave a restart button in the panel and show a modal the player closes manually */
  function endGame(won, title, text) {
    panel.appendChild(el("button", { class: "primary", onclick: restart }, "Play Again"));
    showModal(won, title, text);
  }

  function showModal(won, title, text) {
    const modal = $("modal");
    $("modal-box").className = "modal-box " + (won ? "win" : "lose");
    $("modal-title").textContent = title;
    $("modal-text").textContent = text;
    modal.hidden = false;
    $("modal-again").focus();
  }

  function hideModal() { $("modal").hidden = true; }

  $("modal-close").addEventListener("click", hideModal);
  $("modal-again").addEventListener("click", () => { hideModal(); restart(); });

  function restart() {
    state = createState();
    lastQuestion = lastEvent = null;
    wrongStreak = 0;
    log.replaceChildren();
    renderStats();
    showStart();
  }

  async function loadCSV(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return parseCSV(await res.text());
  }

  async function init() {
    renderStats();
    panel.replaceChildren(el("p", null, "Loading questions and events..."));
    try {
      [questions, events] = await Promise.all([loadCSV("questions.csv"), loadCSV("event.csv")]);
      if (!questions.length || !events.length) throw new Error("questions.csv or event.csv is empty");
      showStart();
    } catch (err) {
      panel.replaceChildren(
        el("p", { class: "result-bad" }, "Could not load questions.csv / event.csv."),
        el("p", null, "Browsers cannot read the CSV files when the page is opened straight from disk. Run `python3 -m http.server` in the project folder and open http://localhost:8000, or use GitHub Pages."),
        el("p", { class: "changes" }, String(err))
      );
    }
  }

  init();
})();
