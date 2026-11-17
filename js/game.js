/* 文字探险 —— 游戏逻辑 */
(function () {
  "use strict";

  const MAX_LIFE = 10;
  const START_COINS = 200;
  const MAX_DAYS = 30;

  // ---------- 纯逻辑（可单独测试） ----------

  /** 解析 CSV 文本（支持 BOM、引号、逗号转义），返回对象数组 */
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
   * 把事件应用到状态上，返回新状态和实际变化量。
   * - life: 数字为增减，"full" 为回满；不超过上限，不低于 0
   * - coins: 可为负（负债）
   * - exp: 只增不减（负数视为 0）
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

  /** 开启新的一天并结算事件 */
  function advanceDay(state, event) {
    const { state: s, delta } = applyEvent(Object.assign({}, state, { day: state.day + 1 }), event);
    if (s.life <= 0) { s.over = true; s.won = false; }
    else if (s.day >= MAX_DAYS) { s.over = true; s.won = true; }
    return { state: s, delta };
  }

  /**
   * 连续答错惩罚（streak 为本次答错后的连错次数）：
   * 1 题不罚；2 题扣 10 金币；3 题扣 1 生命；4 题直接失败。
   */
  function applyWrongAnswer(state, streak) {
    const s = Object.assign({}, state);
    let penalty = "";
    if (streak === 2) {
      s.coins -= 10;
      penalty = "连续答错 2 题，扣除 10 枚金币。";
    } else if (streak === 3) {
      s.life = Math.max(0, s.life - 1);
      penalty = "连续答错 3 题，扣除 1 点生命。";
    } else if (streak >= 4) {
      s.over = true; s.won = false;
      penalty = "连续答错 4 题，冒险到此结束。";
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

  /** 随机取一个元素，尽量避免与上一次相同 */
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

  // ---------- 界面 ----------

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
      el("p", null, "欢迎来到文字探险！你有 10 点生命、200 枚金币。每开启新的一天都要先答对一道题，然后迎接当天的随机事件。坚持 30 天并活下来就能通关。"),
      el("button", { class: "primary", onclick: askQuestion }, "开启第 1 天")
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
      el("p", null, `想要开启第 ${state.day + 1} 天，请先回答问题：`),
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
      panel.appendChild(el("p", { class: "result-good" }, "回答正确！新的一天开始了。"));
      panel.appendChild(el("button", { class: "primary", onclick: startDay }, "继续"));
    } else {
      wrongStreak++;
      const result = applyWrongAnswer(state, wrongStreak);
      state = result.state;
      renderStats();
      panel.appendChild(el("p", { class: "result-bad" }, `回答错误，正确答案是：${q.Answer}。`));
      if (result.penalty) {
        panel.appendChild(el("p", { class: "result-bad" }, result.penalty));
        addLog(`第 ${state.day + 1} 天前：${result.penalty}`);
      } else {
        panel.appendChild(el("p", { class: "changes" }, "这次不罚，但连续答错会有惩罚哦。"));
      }
      if (state.over) {
        lose(state.life <= 0 ? "你的生命耗尽了……" : "你连续答错了 4 道题……");
      } else {
        panel.appendChild(el("button", { class: "primary", onclick: askQuestion }, "换一道题"));
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
    const lifeText = String(ev.life).trim().toLowerCase() === "full" ? `生命回满(${signed(d.life)})` : `生命 ${signed(d.life)}`;
    const changes = `${lifeText}，金币 ${signed(d.coins)}，经验 ${signed(d.exp)}`;
    addLog(`第 ${state.day} 天：${ev.event}（${changes}）`);

    const nodes = [
      el("p", null, `第 ${state.day} 天`),
      el("p", { class: "question" }, ev.event),
      el("p", { class: "changes" }, changes),
    ];

    if (!state.over) {
      nodes.push(el("button", { class: "primary", onclick: askQuestion }, `开启第 ${state.day + 1} 天`));
    }
    panel.replaceChildren(...nodes);
    if (state.over && state.won) win();
    else if (state.over) lose("你的生命耗尽了……");
  }

  function finalStats() {
    return `生命 ${state.life}，金币 ${state.coins}，经验 ${state.exp}`;
  }

  function win() {
    addLog("成功通关！");
    endGame(true, "🎉 恭喜通关！", `你成功度过了 ${MAX_DAYS} 天！最终：${finalStats()}。`);
  }

  function lose(reason) {
    addLog("游戏失败。");
    endGame(false, "游戏结束", `${reason}你坚持了 ${state.day} 天。最终：${finalStats()}。`);
  }

  /** 游戏结束：面板留一个重开按钮，并弹出需手动关闭的弹窗 */
  function endGame(won, title, text) {
    panel.appendChild(el("button", { class: "primary", onclick: restart }, "再来一局"));
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
    panel.replaceChildren(el("p", null, "正在加载题目和事件……"));
    try {
      [questions, events] = await Promise.all([loadCSV("questions.csv"), loadCSV("event.csv")]);
      if (!questions.length || !events.length) throw new Error("questions.csv 或 event.csv 为空");
      showStart();
    } catch (err) {
      panel.replaceChildren(
        el("p", { class: "result-bad" }, "无法加载 questions.csv / event.csv。"),
        el("p", null, "浏览器直接打开本地文件时无法读取 CSV，请在项目目录运行 `python3 -m http.server` 后访问 http://localhost:8000，或使用 GitHub Pages。"),
        el("p", { class: "changes" }, String(err))
      );
    }
  }

  init();
})();
