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
      coins: START_COINS, exp: 0, level: 1, over: false, won: false,
      antidotes: [], // last valid day of each antidote
      antidoteBoughtDay: -1,
      poison: [], // days left for each poison stack
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

  /** Returns "double" / "half" / "nodebt" (any case), or null */
  function special(v) {
    const t = String(v ?? "").trim().toLowerCase();
    return t === "double" || t === "half" || t === "nodebt" ? t : null;
  }

  /** Halve, rounding odd numbers up (no 0.5) */
  function halve(n) { return Math.ceil(n / 2); }

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
   * They also accept double / half (halving rounds odd numbers up):
   * - life: doubling never goes above max life; halving is not reduced by defense
   * - maxlife: adjusts life using the changeMaxLife rules; defense: simply doubled / halved; double at 0 counts as +30
   * - coins: when negative, double counts as nodebt and half has no effect; double at 0 counts as +100
   * coins also accept nodebt: negative coins become 0 (debt cleared); otherwise it counts as +30.
   */
  function applyEvent(state, event) {
    const s = Object.assign({}, state);
    const lifeRaw = String(event.life ?? "").trim().toLowerCase();
    let blocked = 0;
    if (lifeRaw === "full") {
      s.life = s.maxLife;
    } else if (lifeRaw === "double") {
      s.life = Math.min(s.maxLife, s.life * 2);
    } else if (lifeRaw === "half") {
      s.life = halve(s.life);
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
    const coinOp = special(event.coins);
    if (coinOp) {
      if (s.coins < 0) {
        if (coinOp !== "half") s.coins = 0; // nodebt / double: debt cleared
      } else if (coinOp === "nodebt") s.coins += 30;
      else if (coinOp === "double") s.coins = s.coins === 0 ? 100 : s.coins * 2;
      else s.coins = halve(s.coins);
    } else if (setTarget(event.coins) !== null) s.coins = capTo(s.coins, event.coins);
    else s.coins += num(event.coins);
    const expRaw = String(event.exp ?? "").trim().toLowerCase();
    // full: EXP is topped up to the next level (one level up); double: EXP doubles (+5 at 0) but stops at the next level (reaching the threshold counts as full)
    if (expRaw === "full") s.exp = Math.max(s.exp, expForLevel((s.level || 1) + 1));
    else if (expRaw === "double") s.exp = Math.min(s.exp === 0 ? 5 : s.exp * 2, Math.max(s.exp, expForLevel((s.level || 1) + 1)));
    else s.exp += Math.max(0, num(event.exp));
    const maxOp = special(event.maxlife);
    if (maxOp === "double") changeMaxLife(s, s.maxLife);
    else if (maxOp === "half") changeMaxLife(s, halve(s.maxLife) - s.maxLife);
    else if (setTarget(event.maxlife) !== null) changeMaxLife(s, capTo(s.maxLife, event.maxlife) - s.maxLife);
    else changeMaxLife(s, num(event.maxlife));
    const defOp = special(event.defense);
    if (defOp === "double") s.defense = s.defense === 0 ? 30 : s.defense * 2;
    else if (defOp === "half") s.defense = halve(s.defense);
    else if (setTarget(event.defense) !== null) s.defense = Math.max(0, capTo(s.defense, event.defense));
    else s.defense = Math.max(0, s.defense + num(event.defense));
    return {
      state: s,
      delta: {
        life: s.life - state.life, maxLife: s.maxLife - state.maxLife, defense: s.defense - state.defense,
        coins: s.coins - state.coins, exp: s.exp - state.exp, blocked,
      },
    };
  }

  /**
   * Levels: total EXP needed for level L = 30 + 15 × (L-1) × (L-2), i.e. Lv2 30, Lv3 60, Lv4 120, Lv5 210, Lv6 330...
   * (from Lv2 on, each level needs 30 more EXP than the previous gap.) Reaching Lv N: max life +N×5 (life follows the max life rules, no healing), defense +N×2.
   * No level up if the day's event brought life to 0 (the game is already over).
   */
  const LEVEL_MAX_LIFE = 5;  // × new level
  const LEVEL_DEFENSE = 2;   // × new level

  function expForLevel(level) {
    return level <= 1 ? 0 : 30 + 15 * (level - 1) * (level - 2);
  }

  function levelForExp(exp) {
    let level = 1;
    while (exp >= expForLevel(level + 1)) level++;
    return level;
  }

  /** Level up from EXP (mutates s); returns the number of levels gained */
  function applyLevelUps(s) {
    const target = levelForExp(s.exp);
    const gained = Math.max(0, target - s.level);
    for (let lv = s.level + 1; lv <= target; lv++) {
      changeMaxLife(s, LEVEL_MAX_LIFE * lv);
      s.defense += LEVEL_DEFENSE * lv;
    }
    s.level = Math.max(s.level, target);
    return gained;
  }

  /**
   * Poison: when an event's poisoned column is 1, you are poisoned starting the next day for 3 days:
   * life -10 each day (defense does not block it). Poison stacks (two stacks = -20 a day).
   * Poison damage happens before every other effect of the day; if it brings life to 0,
   * you lose right away and that day's event does not happen.
   */
  const POISON_DAMAGE = 10;
  const POISON_DAYS = 3;
  /**
   * Antidote: an event with antidote 1 gives you one antidote (N gives N; they stack).
   * - If you are poisoned when you get it: the poison ends at once (all stacks), no poison damage that day, and one antidote is used.
   * - If you are not poisoned: you keep it for the next 4 days. A poisoned event in that time does not poison you, and uses up one antidote.
   */
  const ANTIDOTE_DAYS = 4;

  /** Start a new day: resolve poison first, then the event */
  function advanceDay(state, event) {
    const start = Object.assign({}, state, { day: state.day + 1 });
    const day = start.day;
    start.antidotes = (state.antidotes || []).filter(last => last >= day);
    let antidoteGain = Math.max(0, num(event.antidote));
    let stacks = state.poison || [];
    const cured = antidoteGain > 0 && stacks.length > 0;
    if (cured) { stacks = []; antidoteGain--; }
    const poisonDamage = Math.min(start.life, POISON_DAMAGE * stacks.length);
    start.life -= poisonDamage;
    start.poison = stacks.map(n => n - 1).filter(n => n > 0);
    if (stacks.length && start.life <= 0) {
      start.over = true; start.won = false;
      const zero = { life: 0, maxLife: 0, defense: 0, coins: 0, exp: 0, blocked: 0 };
      return { state: start, delta: zero, levelUp: null, poisonDamage, poisonDeath: true, poisoned: false, poisonBlocked: false, cured: false, antidoteGain: 0 };
    }
    const { state: s, delta } = applyEvent(start, event);
    let poisoned = num(event.poisoned) === 1, poisonBlocked = false;
    if (poisoned && s.antidotes.length) {
      s.antidotes = s.antidotes.slice().sort((a, b) => a - b).slice(1); // use the one that expires first
      poisoned = false; poisonBlocked = true;
    }
    if (poisoned) s.poison = s.poison.concat(POISON_DAYS);
    if (antidoteGain) s.antidotes = s.antidotes.concat(Array(antidoteGain).fill(day + ANTIDOTE_DAYS));
    const lifeBefore = s.life, maxBefore = s.maxLife, defBefore = s.defense;
    const levels = s.life > 0 ? applyLevelUps(s) : 0;
    const levelUp = levels ? { levels, level: s.level, life: s.life - lifeBefore, maxLife: s.maxLife - maxBefore, defense: s.defense - defBefore } : null;
    if (s.life <= 0) { s.over = true; s.won = false; }
    else if (s.day >= MAX_DAYS) { s.over = true; s.won = true; }
    return { state: s, delta, levelUp, poisonDamage, poisonDeath: false, poisoned, poisonBlocked, cured, antidoteGain };
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
    { id: "antidote", type: "antidote", amount: 1, price: 200 },
  ];

  /**
   * Buy an item. Only while the game is running and life is above 0; you need enough coins (no buying on debt);
   * bought life never goes above max life, and life cannot be bought at full life.
   */
  function buyItem(state, item) {
    if (state.over || state.life <= 0) return { ok: false, state, reason: "You cannot buy anything at 0 life." };
    if (state.coins < item.price) return { ok: false, state, reason: "Not enough coins." };
    if (item.type === "life" && state.life >= state.maxLife) return { ok: false, state, reason: "Your life is already full." };
    if (item.type === "antidote" && state.antidoteBoughtDay === state.day) return { ok: false, state, reason: "You can only buy 1 antidote per day." };
    const s = Object.assign({}, state);
    s.coins -= item.price;
    if (item.type === "antidote") {
      // poisoned: cured at once; otherwise lasts for the next ANTIDOTE_DAYS days
      s.antidoteBoughtDay = s.day;
      const cured = (s.poison || []).length > 0;
      if (cured) s.poison = [];
      else s.antidotes = (s.antidotes || []).filter(last => last > s.day).concat(s.day + ANTIDOTE_DAYS);
      return { ok: true, state: s, gained: 1, cured };
    }
    if (item.type === "defense") s.defense += item.amount;
    else s.life = Math.min(s.maxLife, s.life + item.amount);
    return { ok: true, state: s, gained: item.type === "defense" ? s.defense - state.defense : s.life - state.life };
  }

  /**
   * Event chains: the next column holds the SN of the event that must happen the following day;
   * 0 or blank means no follow-up (the next day is random as usual).
   * The prev column holds the SN of the event before it: events whose prev is not 0 only happen through a chain and are
   * never drawn at random.
   */
  function findEvent(events, sn) {
    const key = String(sn ?? "").trim();
    if (!key || key === "0") return null;
    return events.find(e => String(e.SN).trim() === key) || null;
  }

  /**
   * Events that can be drawn at random: prev is 0, and the whole chain fits in the days left.
   * The chain length comes from the linkcount column of the chain's first event (0 counts as 1, a single event).
   * day is the day about to start; days left = MAX_DAYS - day + 1 (including today). E.g. a 3-event chain can be drawn on day 28 at the latest, never on day 29.
   */
  function randomPool(events, day) {
    const hasPrev = e => { const k = String(e.prev ?? "").trim(); return k !== "" && k !== "0"; };
    const daysLeft = day ? MAX_DAYS - day + 1 : Infinity;
    const pool = events.filter(e => !hasPrev(e) && Math.max(1, num(e.linkcount)) <= daysLeft);
    if (pool.length) return pool;
    const fallback = events.filter(e => !hasPrev(e));
    return fallback.length ? fallback : events;
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
    START_MAX_LIFE, START_DEFENSE, START_COINS, MAX_DAYS, SHOP_ITEMS, POISON_DAMAGE, POISON_DAYS, ANTIDOTE_DAYS,
    parseCSV, parseRows, parseQuestions, decodeText, createState, setTarget, special, applyEvent, findEvent, randomPool, changeMaxLife, expForLevel, levelForExp, applyLevelUps, advanceDay, applyWrongAnswer, buyItem, shuffle, pickRandom,
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
  let isDefaultBank = true; // still the bundled questions.csv, nothing imported
  let homework = null;      // opened from a homework link: { title, questions }
  let events = [];
  let state = createState();
  let lastQuestion = null;
  let lastEvent = null;
  let pendingEvent = null;
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

  /** Wrap signed numbers in colored spans: positive green, negative red (0 has no sign and stays plain) */
  function colorize(text) {
    return text.split(/([+-]\d+)/).filter(Boolean).map(part =>
      /^[+-]\d+$/.test(part) ? el("span", { class: part[0] === "+" ? "num-pos" : "num-neg" }, part) : document.createTextNode(part));
  }

  function renderStats() {
    $("stat-day").textContent = `${state.day} / ${MAX_DAYS}`;
    $("stat-life").textContent = `${state.life} / ${state.maxLife}`;
    $("stat-defense").textContent = state.defense;
    $("stat-coins").textContent = state.coins;
    $("stat-coins").classList.toggle("negative", state.coins < 0);
    $("stat-level").textContent = `Lv ${state.level}`;
    $("stat-exp").textContent = `${state.exp} / ${expForLevel(state.level + 1)}`;
    renderShop();
  }

  // ---------- Shop ----------

  let shopMsg = "";

  function itemLabel(item) {
    if (item.type === "antidote") return `Antidote x1 (${item.price} coins, 1 per day)`;
    return `${item.type === "defense" ? "Defense" : "Life"} +${item.amount} (${item.price} coins)`;
  }

  function renderShop() {
    const box = $("shop-items");
    if (!box) return;
    box.replaceChildren(...SHOP_ITEMS.map(item => {
      const disabled = state.over || state.life <= 0 || state.coins < item.price ||
        (item.type === "life" && state.life >= state.maxLife) ||
        (item.type === "antidote" && state.antidoteBoughtDay === state.day);
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
      if (item.type === "antidote") {
        const held = state.antidotes.length;
        const what = r.cured ? "Antidote cured the poison" : `Antidote +1 (blocks poison for the next ${ANTIDOTE_DAYS} days)`;
        shopMsg = `Bought: ${what} for ${item.price} coins.` + (held ? ` Antidotes held: ${held}.` : "");
        addLog(`Shop: ${what} (-${item.price} coins)` + (held ? `, Antidotes held: ${held}` : ""));
        renderStats();
        return;
      }
      const what = item.type === "defense" ? "Defense" : "Life";
      shopMsg = `Bought: ${what} +${r.gained} for ${item.price} coins.`;
      addLog(`Shop: ${what} +${r.gained} (-${item.price} coins)`);
    }
    renderStats();
  }

  function addLog(...parts) {
    const li = el("li");
    li.append(...parts);
    log.insertBefore(li, log.firstChild);
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
    const ev = pendingEvent || pickRandom(randomPool(events, state.day + 1), lastEvent);
    lastEvent = ev;
    pendingEvent = findEvent(events, ev.next);
    const result = advanceDay(state, ev);
    state = result.state;
    renderStats();

    const d = result.delta;
    if (result.poisonDeath) {
      const msg = `Poison: Life ${signed(-result.poisonDamage)}`;
      addLog(`Day ${state.day}: `, ...colorize(msg));
      const c = el("p", { class: "changes" }); c.append("☠️ ", ...colorize(msg));
      panel.replaceChildren(el("p", null, `Day ${state.day}`), c);
      lose("The poison killed you... ");
      return;
    }
    const lifeLabel = { full: "Life fully restored", double: "Life doubled", half: "Life halved" }[String(ev.life).trim().toLowerCase()];
    const lifeText = lifeLabel ? `${lifeLabel} (${signed(d.life)})` : `Life ${signed(d.life)}`;
    const parts = [];
    if (result.cured) parts.push("Antidote cured the poison");
    if (result.poisonDamage) parts.push(`Poison ${signed(-result.poisonDamage)}`);
    parts.push(lifeText);
    if (d.blocked > 0) parts.push(`Defense blocked ${d.blocked} damage`);
    parts.push(`Coins ${signed(d.coins)}`, `EXP ${signed(d.exp)}`);
    if (d.maxLife) parts.push(`Max life ${signed(d.maxLife)}`);
    if (d.defense) parts.push(`Defense ${signed(d.defense)}`);
    if (result.poisoned) parts.push(`Poisoned! Life -${POISON_DAMAGE} each day for the next ${POISON_DAYS} days`);
    if (result.poisonBlocked) parts.push("Antidote blocked the poison (Antidote -1)");
    if (result.antidoteGain) parts.push(`Antidote +${result.antidoteGain} (blocks poison for the next ${ANTIDOTE_DAYS} days)`);
    if (state.antidotes.length) parts.push(`Antidotes held: ${state.antidotes.length}`);
    const changes = parts.join(", ");
    addLog(`Day ${state.day}: ${ev.event} (`, ...colorize(changes), ")");

    const nodes = [
      el("p", null, `Day ${state.day}`),
      el("p", { class: "question" }, ev.event),
      (() => { const c = el("p", { class: "changes" }); c.append(...colorize(changes)); return c; })(),
    ];
    if (result.levelUp) {
      const u = result.levelUp;
      const up = `Level up! You reached Lv ${u.level}: Max life ${signed(u.maxLife)}, Defense ${signed(u.defense)}` + (u.life ? `, Life ${signed(u.life)}` : "");
      const p = el("p", { class: "level-up" }); p.append("⭐ ", ...colorize(up));
      nodes.push(p);
      addLog("⭐ ", ...colorize(up));
    }

    if (!state.over) {
      nodes.push(el("button", { class: "primary", onclick: askQuestion }, `Start Day ${state.day + 1}`));
    }
    panel.replaceChildren(...nodes);
    if (state.over && state.won) win();
    else if (state.over) lose("You ran out of life... ");
  }

  function finalStats() {
    return `Lv ${state.level}, Life ${state.life}/${state.maxLife}, Defense ${state.defense}, Coins ${state.coins}, EXP ${state.exp}`;
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
    lastQuestion = lastEvent = pendingEvent = null;
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
    $("qbank-info").textContent = homework
      ? `📘 Homework: ${homework.title} (${questions.length} questions)`
      : `Question set: ${questionSource} (${questions.length} questions)`;
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
    isDefaultBank = false;
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

  // ---------- Publish homework (no scores recorded) ----------
  const toRow = q => [q.Question, q.Answer, q.Distractor1, q.Distractor2, q.Distractor3];
  const fromRow = r => ({ Question: r[0], Answer: r[1], Distractor1: r[2], Distractor2: r[3], Distractor3: r[4] });

  $("btn-publish").addEventListener("click", () => {
    $("publish-modal").hidden = false;
    Homework.renderPublish($("publish-box"), {
      questions: questions.map(toRow), source: questionSource, isDefault: isDefaultBank,
      onClose: () => { $("publish-modal").hidden = true; },
    });
  });

  async function loadCSV(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return parseCSV(await res.text());
  }

  async function init() {
    // Homework link: use the questions in the link (or the default set); students cannot change them
    homework = Homework.fromLocation();
    if (homework && homework.error) { toast(homework.message); homework = null; }
    if (homework) {
      document.body.classList.add("hw-mode");
      document.title = `${homework.title} · ${document.title}`;
    }
    const hwQuestions = homework && homework.questions;
    renderStats();
    panel.replaceChildren(el("p", null, "Loading questions and events..."));
    try {
      const [qBuf, evs] = await Promise.all([
        hwQuestions ? null : fetch("questions.csv").then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`questions.csv: HTTP ${r.status}`)))),
        loadCSV("event.csv"),
      ]);
      questions = hwQuestions ? hwQuestions.map(fromRow) : parseQuestions(decodeText(qBuf));
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
