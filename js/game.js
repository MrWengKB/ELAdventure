/* 30 Days of Adventure: game logic */
(function () {
  "use strict";

  const START_MAX_LIFE = 100;
  const START_DEFENSE = 10;
  const START_COINS = 200;
  const MAX_DAYS = 30;

  // ---------- Pure logic (testable on its own) ----------

  /** Parse CSV text into rows of fields (handles BOM, quotes, escaped commas, CRLF) */
  function parseRows(text) {
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

    return rows;
  }

  /** Parse CSV text with a header row into an array of objects */
  function parseCSV(text) {
    const rows = parseRows(text);
    const nonEmpty = rows.filter(r => r.some(f => f.trim() !== ""));
    if (!nonEmpty.length) return [];
    const header = nonEmpty[0].map(h => h.trim());
    return nonEmpty.slice(1).map(r => {
      const obj = {};
      header.forEach((h, idx) => { obj[h] = (r[idx] || "").trim(); });
      return obj;
    });
  }

  /**
   * Parse a question-set CSV: 5 columns per row (question, answer, distractor 1, 2, 3).
   * Columns are read by position; a header row (first cell "Question" or "题干") is skipped;
   * rows with fewer than 5 columns or an empty cell are skipped;
   * if a row has no ASCII commas, the Chinese comma "，" is used as a fallback separator.
   */
  function parseQuestions(text) {
    const out = [];
    for (let r of parseRows(text)) {
      if (r.length === 1 && r[0].includes("，")) r = r[0].split("，");
      r = r.map(x => x.trim());
      if (r.length < 5 || r.slice(0, 5).some(x => x === "")) continue;
      if (/^(question|题干|题目|问题)$/i.test(r[0])) continue;
      out.push({ Question: r[0], Answer: r[1], Distractor1: r[2], Distractor2: r[3], Distractor3: r[4] });
    }
    return out;
  }

  /** Detect UTF-8 / GBK automatically (Excel often saves Chinese CSV files as GBK) */
  function decodeText(buffer) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch (e) {
      try { return new TextDecoder("gbk").decode(buffer); }
      catch (e2) { return new TextDecoder("utf-8").decode(buffer); }
    }
  }

  function createState() {
    return {
      day: 0, life: START_MAX_LIFE, maxLife: START_MAX_LIFE, defense: START_DEFENSE,
      coins: START_COINS, exp: 0, over: false, won: false,
    };
  }

  /** Turn a CSV value into an integer; blank or non-numeric counts as 0 */
  function num(v) {
    const n = parseInt(String(v ?? "").trim(), 10);
    return isNaN(n) ? 0 : n;
  }

  /**
   * Change max life (mutates s):
   * - at full life: still full after the change;
   * - not at full life: no healing; life is only lowered if it is above the new max.
   */
  /**
   * Parse the "set N" syntax (any case, space optional, e.g. "set 10", "SET10"); returns N, or null if it is not a set value.
   */
  function setTarget(v) {
    const m = /^set\s*(-?\d+)$/i.exec(String(v ?? "").trim());
    return m ? parseInt(m[1], 10) : null;
  }

  /** Lower to N only if the current value is greater; otherwise unchanged */
  function capTo(current, v) {
    const t = setTarget(v);
    return t !== null && current > t ? t : current;
  }

  function changeMaxLife(s, d) {
    if (!d) return;
    const wasFull = s.life >= s.maxLife;
    s.maxLife = Math.max(1, s.maxLife + d);
    s.life = wasFull ? s.maxLife : Math.min(s.life, s.maxLife);
  }

  /**
   * Apply an event to the state; returns the new state and the actual changes. Resolved in order:
   * 1. life: a number is a change, "full" restores to max; a negative value has defense added first
   *    (down to 0 at most, never turning into healing); never above max or below 0
   * 2. coins: may go negative (debt); exp: only increases (negative values count as 0)
   * 3. maxlife: change to max life, see changeMaxLife
   * 4. defense: change to defense, never below 0
   * life, coins, maxlife and defense also accept "set N": the value becomes N only if it is currently greater than N.
   * A life set is not reduced by defense; a max life set adjusts life using the changeMaxLife rules.
   */
  function applyEvent(state, event) {
    const s = Object.assign({}, state);
    const lifeRaw = String(event.life ?? "").trim().toLowerCase();
    let blocked = 0;
    if (lifeRaw === "full") {
      s.life = s.maxLife;
    } else if (setTarget(lifeRaw) !== null) {
      s.life = Math.max(0, capTo(s.life, lifeRaw));
    } else {
      let d = num(lifeRaw);
      if (d < 0) {
        const reduced = Math.min(0, d + s.defense);
        blocked = reduced - d;
        d = reduced;
      }
      s.life = Math.min(s.maxLife, Math.max(0, s.life + d));
    }
    if (setTarget(event.coins) !== null) s.coins = capTo(s.coins, event.coins);
    else s.coins += num(event.coins);
    s.exp += Math.max(0, num(event.exp));
    if (setTarget(event.maxlife) !== null) changeMaxLife(s, capTo(s.maxLife, event.maxlife) - s.maxLife);
    else changeMaxLife(s, num(event.maxlife));
    if (setTarget(event.defense) !== null) s.defense = Math.max(0, capTo(s.defense, event.defense));
    else s.defense = Math.max(0, s.defense + num(event.defense));
    return {
      state: s,
      delta: {
        life: s.life - state.life, maxLife: s.maxLife - state.maxLife, defense: s.defense - state.defense,
        coins: s.coins - state.coins, exp: s.exp - state.exp, blocked,
      },
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
   * 1: no penalty; 2: lose 10 coins; 3: lose 10 life (not reduced by defense); 4: game over.
   */
  function applyWrongAnswer(state, streak) {
    const s = Object.assign({}, state);
    let penalty = "";
    if (streak === 2) {
      s.coins -= 10;
      penalty = "2 wrong answers in a row: you lose 10 coins.";
    } else if (streak === 3) {
      s.life = Math.max(0, s.life - 10);
      penalty = "3 wrong answers in a row: you lose 10 life.";
    } else if (streak >= 4) {
      s.over = true; s.won = false;
      penalty = "4 wrong answers in a row: your adventure ends here.";
    }
    if (s.life <= 0) { s.over = true; s.won = false; }
    return { state: s, penalty };
  }

  /** Shop items */
  const SHOP_ITEMS = [
    { id: "def5", type: "defense", amount: 5, price: 100 },
    { id: "def10", type: "defense", amount: 10, price: 180 },
    { id: "def15", type: "defense", amount: 15, price: 270 },
    { id: "life10", type: "life", amount: 10, price: 100 },
    { id: "life20", type: "life", amount: 20, price: 180 },
    { id: "life30", type: "life", amount: 30, price: 270 },
  ];

  /**
   * Buy an item. Only while the game is running and life is above 0; you need enough coins (no buying on debt);
   * bought life never goes above max life, and life cannot be bought at full life.
   */
  function buyItem(state, item) {
    if (state.over || state.life <= 0) return { ok: false, state, reason: "You cannot buy anything at 0 life." };
    if (state.coins < item.price) return { ok: false, state, reason: "Not enough coins." };
    if (item.type === "life" && state.life >= state.maxLife) return { ok: false, state, reason: "Your life is already full." };
    const s = Object.assign({}, state);
    s.coins -= item.price;
    if (item.type === "defense") s.defense += item.amount;
    else s.life = Math.min(s.maxLife, s.life + item.amount);
    return { ok: true, state: s, gained: item.type === "defense" ? s.defense - state.defense : s.life - state.life };
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

  const Logic = {
    START_MAX_LIFE, START_DEFENSE, START_COINS, MAX_DAYS, SHOP_ITEMS,
    parseCSV, parseRows, parseQuestions, decodeText, createState, setTarget, applyEvent, changeMaxLife, advanceDay, applyWrongAnswer, buyItem, shuffle, pickRandom,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = Logic;
  }
  if (typeof document === "undefined") return;

  // ---------- UI ----------

  const $ = id => document.getElementById(id);
  const panel = $("panel");
  const log = $("log");

  let questions = [];
  let questionSource = "questions.csv";
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
    $("stat-life").textContent = `${state.life} / ${state.maxLife}`;
    $("stat-defense").textContent = state.defense;
    $("stat-coins").textContent = state.coins;
    $("stat-coins").classList.toggle("negative", state.coins < 0);
    $("stat-exp").textContent = state.exp;
    renderShop();
  }

  // ---------- Shop ----------

  let shopMsg = "";

  function itemLabel(item) {
    return `${item.type === "defense" ? "Defense" : "Life"} +${item.amount} (${item.price} coins)`;
  }

  function renderShop() {
    const box = $("shop-items");
    if (!box) return;
    box.replaceChildren(...SHOP_ITEMS.map(item => {
      const disabled = state.over || state.life <= 0 || state.coins < item.price ||
        (item.type === "life" && state.life >= state.maxLife);
      const b = el("button", { class: "shop-item " + item.type, onclick: () => buy(item) }, itemLabel(item));
      b.disabled = disabled;
      return b;
    }));
    $("shop-msg").textContent = shopMsg;
  }

  function buy(item) {
    const r = buyItem(state, item);
    if (!r.ok) {
      shopMsg = r.reason;
    } else {
      state = r.state;
      const what = item.type === "defense" ? "Defense" : "Life";
      shopMsg = `Bought: ${what} +${r.gained} for ${item.price} coins.`;
      addLog(`Shop: ${what} +${r.gained} (-${item.price} coins)`);
    }
    renderStats();
  }

  function addLog(text) {
    log.insertBefore(el("li", null, text), log.firstChild);
  }

  function showStart() {
    panel.replaceChildren(
      el("p", null, `Welcome to 30 Days of Adventure! You start with ${START_MAX_LIFE} life, ${START_DEFENSE} defense and ${START_COINS} coins. Defense blocks some of the damage you take. To begin each new day you must answer a question correctly, then face that day's random event. You can spend coins in the shop below at any time to buy defense and life. Survive ${MAX_DAYS} days to win.`),
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
      }
      // Warn what the next wrong answer will cost
      const warnings = { 1: "No penalty this time. ⚠️ One more wrong answer will cost you 10 coins.", 2: "⚠️ One more wrong answer will cost you 10 life.", 3: "⚠️ One more wrong answer and the game is over!" };
      if (!state.over && warnings[wrongStreak]) {
        panel.appendChild(el("p", { class: "warning" }, warnings[wrongStreak]));
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
    const parts = [lifeText];
    if (d.blocked > 0) parts.push(`Defense blocked ${d.blocked} damage`);
    parts.push(`Coins ${signed(d.coins)}`, `EXP ${signed(d.exp)}`);
    if (d.maxLife) parts.push(`Max life ${signed(d.maxLife)}`);
    if (d.defense) parts.push(`Defense ${signed(d.defense)}`);
    const changes = parts.join(", ");
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
    return `Life ${state.life}/${state.maxLife}, Defense ${state.defense}, Coins ${state.coins}, EXP ${state.exp}`;
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
    shopMsg = "";
    log.replaceChildren();
    renderStats();
    showStart();
  }

  // ---------- Import a question set ----------

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function renderQuestionInfo() {
    $("qbank-info").textContent = `Question set: ${questionSource} (${questions.length} questions)`;
  }

  $("btn-import").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", async () => {
    const input = $("file-input");
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    const parsed = parseQuestions(decodeText(await file.arrayBuffer()));
    const n = parsed.length;
    if (!n) { toast("❌ No questions found. Please check the CSV format (see 📋 Question format)."); return; }
    questions = parsed;
    questionSource = file.name;
    lastQuestion = null;
    renderQuestionInfo();
    toast(`✅ Imported "${file.name}": ${n} questions`);
  });

  $("btn-format").addEventListener("click", () => { $("format-modal").hidden = false; });
  $("format-close").addEventListener("click", () => { $("format-modal").hidden = true; });
  $("format-template").addEventListener("click", () => {
    // UTF-8 BOM lets Excel open non-ASCII text correctly
    const blob = new Blob(["\uFEFFQuestion,Answer,Distractor1,Distractor2,Distractor3\r\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "questions-template.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Blank template downloaded");
  });

  async function loadCSV(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return parseCSV(await res.text());
  }

  async function init() {
    renderStats();
    panel.replaceChildren(el("p", null, "Loading questions and events..."));
    try {
      const [qBuf, evs] = await Promise.all([
        fetch("questions.csv").then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`questions.csv: HTTP ${r.status}`)))),
        loadCSV("event.csv"),
      ]);
      questions = parseQuestions(decodeText(qBuf));
      events = evs;
      renderQuestionInfo();
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
