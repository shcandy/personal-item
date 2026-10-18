/* ============================================================
   RHEIN TERMINAL · app.js
   模块化决策终端 —— 交互逻辑
   ============================================================ */
"use strict";

/* ---------- 小工具 ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* 隐私模式等场景下静默失败 */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
};

const pad2 = (n) => String(n).padStart(2, "0");
const pad3 = (n) => String(n).padStart(3, "0");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const nowTime = () => {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

function toast(message, kind = "") {
  const root = $("#toastRoot");
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

/* 当日计数（带日期戳的简单计数器） */
function todayCount(key) {
  const rec = store.get(key, { date: "", n: 0 });
  if (rec.date !== todayKey()) return { date: todayKey(), n: 0 };
  return rec;
}
function bumpToday(key) {
  const rec = todayCount(key);
  rec.n += 1;
  store.set(key, rec);
  return rec.n;
}

/* ---------- 音频提示 ---------- */
let audioCtx = null;
function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = audioCtx || new AC();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t = audioCtx.currentTime;
    [880, 1174.66, 880].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const at = t + i * 0.22;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(at);
      osc.stop(at + 0.22);
    });
  } catch (e) { /* 无音频设备时静默 */ }
}

/* ============================================================
   M-01 随机选择器
   ============================================================ */
const FOOD_PRESETS = [
  { name: "番茄牛腩饭", cat: "rice" },
  { name: "照烧鸡腿饭", cat: "rice" },
  { name: "咖喱蛋包饭", cat: "rice" },
  { name: "韩式石锅拌饭", cat: "rice" },
  { name: "台式卤肉饭", cat: "rice" },
  { name: "腊味煲仔饭", cat: "rice" },
  { name: "豚骨拉面", cat: "noodle" },
  { name: "日式乌冬面", cat: "noodle" },
  { name: "兰州牛肉面", cat: "noodle" },
  { name: "意式肉酱面", cat: "noodle" },
  { name: "武汉热干面", cat: "noodle" },
  { name: "鸡胸沙拉碗", cat: "light" },
  { name: "牛油果全麦吐司", cat: "light" },
  { name: "三文鱼波奇饭", cat: "light" },
  { name: "藜麦鸡肉碗", cat: "light" },
  { name: "越南鲜虾春卷", cat: "light" },
  { name: "关东煮", cat: "pot" },
  { name: "酸菜鱼", cat: "pot" },
  { name: "麻辣烫", cat: "pot" },
  { name: "日式寿喜锅", cat: "pot" },
  { name: "牛肉芝士汉堡", cat: "snack" },
  { name: "虾仁煎饺", cat: "snack" },
  { name: "寿司拼盘", cat: "snack" },
  { name: "烤鸡三明治", cat: "snack" },
  { name: "越南牛肉河粉", cat: "snack" }
];

const CATS = [
  { id: "all", label: "全部" },
  { id: "rice", label: "饭 · RICE" },
  { id: "noodle", label: "面 · NOODLE" },
  { id: "light", label: "轻食 · LIGHT" },
  { id: "pot", label: "汤锅 · POT" },
  { id: "snack", label: "小食 · SNACK" }
];

const picker = {
  tab: "preset",
  catFilter: "all",
  qty: 1,
  noRepeat: true,   // true = 去重
  consume: false,   // true = 抽取后从池中移除
  running: false
};

let presetSel = new Set(store.get("rhine.presetSel", null) || FOOD_PRESETS.map((f) => f.name));
let customPool = store.get("rhine.customPool", []);
let customSel = new Set(store.get("rhine.customSel", null) || customPool);
let history = store.get("rhine.history", []);

function persistPools() {
  store.set("rhine.presetSel", Array.from(presetSel));
  store.set("rhine.customPool", customPool);
  store.set("rhine.customSel", Array.from(customSel));
  store.set("rhine.history", history);
}

/* —— 渲染：分类 —— */
function renderCats() {
  const row = $("#catRow");
  row.innerHTML = "";
  CATS.forEach((c) => {
    const b = document.createElement("button");
    b.className = "cat" + (picker.catFilter === c.id ? " active" : "");
    b.textContent = c.label;
    b.addEventListener("click", () => {
      picker.catFilter = c.id;
      renderCats();
      renderPresetPool();
    });
    row.appendChild(b);
  });
}

/* —— 渲染：预设池 —— */
function renderPresetPool() {
  const wrap = $("#presetPool");
  wrap.innerHTML = "";
  const list = FOOD_PRESETS.filter(
    (f) => picker.catFilter === "all" || f.cat === picker.catFilter
  );
  list.forEach((f) => {
    const btn = document.createElement("button");
    btn.className = "item-chip" + (presetSel.has(f.name) ? " on" : "");
    btn.innerHTML =
      `<span class="tick">✓</span><span class="chip-name">${escapeHtml(f.name)}</span>`;
    btn.title = "点击选中 / 取消选中";
    btn.addEventListener("click", () => {
      if (presetSel.has(f.name)) presetSel.delete(f.name);
      else presetSel.add(f.name);
      persistPools();
      renderPresetPool();
      refreshPoolUI();
      renderPreviewChips();
    });
    wrap.appendChild(btn);
  });
  const shown = list.filter((f) => presetSel.has(f.name)).length;
  $("#presetCount").textContent = `已选 ${shown} / ${list.length}`;
}

/* —— 渲染：导入池 —— */
function renderImportPool() {
  const wrap = $("#importPool");
  wrap.innerHTML = "";
  if (!customPool.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "暂无导入项 —— 通过上方拖放或粘贴载入名单。";
    wrap.appendChild(empty);
  }
  customPool.forEach((name, i) => {
    const btn = document.createElement("button");
    btn.className = "item-chip" + (customSel.has(name) ? " on" : "");
    btn.innerHTML =
      `<span class="tick">✓</span><span class="chip-name">${escapeHtml(name)}</span>
       <span class="del" title="从名单移除">✕</span>`;
    btn.addEventListener("click", (e) => {
      if (e.target.classList.contains("del")) {
        customPool.splice(i, 1);
        customSel.delete(name);
        persistPools();
        renderImportPool();
        refreshPoolUI();
        updateImportStatus(`已移除「${name}」`);
        return;
      }
      if (customSel.has(name)) customSel.delete(name);
      else customSel.add(name);
      persistPools();
      renderImportPool();
      refreshPoolUI();
    });
    wrap.appendChild(btn);
  });
  $("#importCount").textContent = `已选 ${customSel.size} / ${customPool.length}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* —— 导入解析 —— */
function pickColumn(header) {
  if (header.length === 1) return 0;
  const hit = header.findIndex((h) =>
    /名称|名字|食物|选项|内容|姓名|item|name|title|value/i.test(h)
  );
  return hit >= 0 ? hit : 0;
}

function parseCustomText(text) {
  const t = String(text || "").replace(/^\uFEFF/, "").replace(/\r/g, "").trim();
  if (!t) return [];

  /* 尝试 JSON：数组，或含 items/options/data/list 的对象 */
  if (/^[\[{]/.test(t)) {
    try {
      const obj = JSON.parse(t);
      const arr = Array.isArray(obj)
        ? obj
        : obj.items || obj.options || obj.data || obj.list || obj.名单 || obj.values;
      if (Array.isArray(arr)) {
        return arr
          .map((x) =>
            typeof x === "string" ? x
            : x && (x.name || x.title || x.label || x.text || x.食物 || x.选项 || x.value || "")
          )
          .map((s) => String(s).trim())
          .filter(Boolean);
      }
    } catch (e) { /* 不是合法 JSON，继续按文本解析 */ }
  }

  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  /* CSV 探测：首行含逗号，且后续行也普遍含逗号 */
  const commas = lines.map((l) => (l.match(/[,，]/g) || []).length);
  const csvLike =
    lines.length >= 2 &&
    commas[0] > 0 &&
    commas.slice(1).filter((c) => c > 0).length >= Math.min(3, lines.length - 1);

  if (csvLike) {
    const header = lines[0].split(/[,，]/).map((h) => h.trim());
    const colIdx = pickColumn(header);
    return lines
      .slice(1)
      .map((row) => row.split(/[,，]/)[colIdx])
      .map((s) => (s || "").trim())
      .filter((s) => s && !/^["']$/.test(s));
  }

  /* 纯文本：去项目符号、编号 */
  return lines
    .filter((l) => !/^[#;]/.test(l))
    .map((l) => l.replace(/^[\s]*[-*•·—\d.)、]+[\s]*/, "").trim())
    .filter((l) => l && !/^(名称|名字|选项|内容|食物|姓名|name|item|title)$/i.test(l));
}

function loadCustom(items, sourceLabel) {
  const clean = Array.from(new Set(items.map((s) => s.trim()).filter(Boolean)));
  if (!clean.length) {
    toast("未解析到有效选项，请检查格式。", "err");
    return false;
  }
  customPool = clean.slice();
  customSel = new Set(clean);
  persistPools();
  renderImportPool();
  refreshPoolUI();
  updateImportStatus(`已载入 ${clean.length} 项 · 来源：${sourceLabel}`);
  toast(`名单载入完成：${clean.length} 项`, "ok");
  return true;
}

function updateImportStatus(text) {
  $("#importStatus").textContent = `当前名单：${text}`;
}

/* —— 当前活动池 —— */
function activePool() {
  if (picker.tab === "preset") {
    return FOOD_PRESETS.filter((f) => presetSel.has(f.name)).map((f) => f.name);
  }
  return customPool.filter((n) => customSel.has(n));
}

function refreshPoolUI() {
  const pool = activePool();
  const max = picker.noRepeat ? Math.min(10, pool.length) : 10;
  if (picker.qty > Math.max(1, max)) picker.qty = Math.max(1, max);
  if (picker.qty > 10) picker.qty = 10;
  $("#qtyVal").textContent = picker.qty;
  $("#execNote").textContent = `当前池 ${pool.length} 项 · 抽取 ${picker.qty} 项`;
  $("#execBtn").disabled = !pool.length || picker.running;
}

/* —— 抽取 —— */
function sampleItems(pool, qty, unique) {
  const arr = pool.slice();
  if (unique) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, qty);
  }
  const out = [];
  for (let k = 0; k < qty; k++) out.push(arr[Math.floor(Math.random() * arr.length)]);
  return out;
}

async function executeDraw() {
  if (picker.running) return;
  const pool = activePool();
  if (!pool.length) {
    toast("当前名单为空，请先选择或导入选项。", "err");
    return;
  }
  const qty = Math.min(picker.qty, picker.noRepeat ? pool.length : picker.qty);
  const items = sampleItems(pool, qty, picker.noRepeat);

  picker.running = true;
  refreshPoolUI();

  const stage = $("#resultStage");
  const grid = $("#resultGrid");
  stage.hidden = false;
  grid.innerHTML = "";
  const reel = document.createElement("div");
  reel.className = "reel-text mono";
  reel.textContent = "···";
  grid.appendChild(reel);
  stage.scrollIntoView({ behavior: "smooth", block: "nearest" });

  /* 滚轮动画：逐渐减速 */
  const totalMs = 900;
  const start = performance.now();
  await new Promise((resolve) => {
    const step = (now) => {
      const p = Math.min(1, (now - start) / totalMs);
      reel.textContent = pool[Math.floor(Math.random() * pool.length)];
      if (p < 1) {
        const wait = 45 + 190 * p * p;
        setTimeout(() => requestAnimationFrame(step), wait);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
  await delay(120);

  /* 渲染结果 */
  grid.innerHTML = "";
  items.forEach((name, i) => {
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML =
      `<div class="r-idx">NO.${pad2(i + 1)}</div>
       <div class="r-name">${escapeHtml(name)}</div>
       <div class="r-tag">RHEIN PICK</div>
       <div class="r-stamp">VERIFIED</div>`;
    grid.appendChild(card);
  });

  /* 消耗：从池中移除 */
  if (picker.consume) {
    items.forEach((name) => {
      presetSel.delete(name);
      customSel.delete(name);
      customPool = customPool.filter((n) => n !== name);
    });
    persistPools();
    renderPresetPool();
    renderImportPool();
  }

  /* 记录 */
  history.unshift({ t: Date.now(), items: items.slice() });
  history = history.slice(0, 12);
  persistPools();
  renderHistory();

  const runs = store.get("rhine.runs", 0) + 1;
  store.set("rhine.runs", runs);
  bumpToday("rhine.today.decisions");

  picker.running = false;
  refreshPoolUI();
  refreshStats();
  toast(`抽取完成：${items.join(" / ")}`, "ok");
}

function renderHistory() {
  const sec = $("#historySec");
  const list = $("#historyList");
  if (!history.length) {
    sec.hidden = true;
    return;
  }
  sec.hidden = false;
  list.innerHTML = "";
  history.forEach((h) => {
    const li = document.createElement("li");
    const d = new Date(h.t);
    const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    const more = h.items.length > 1 ? ` 等 ${h.items.length} 项` : "";
    li.innerHTML =
      `<span class="h-time">${time}</span>
       <span class="h-items">${escapeHtml(h.items[0])}${more}</span>`;
    list.appendChild(li);
  });
}

/* —— 首页预览 —— */
function renderPreviewChips() {
  const wrap = $("#previewChips");
  wrap.innerHTML = "";
  const names = Array.from(presetSel);
  names.slice(0, 6).forEach((n) => {
    const s = document.createElement("span");
    s.className = "pchip";
    s.textContent = n;
    wrap.appendChild(s);
  });
  if (names.length > 6) {
    const s = document.createElement("span");
    s.className = "pchip more";
    s.textContent = `+${names.length - 6}`;
    wrap.appendChild(s);
  }
  $("#previewCount").textContent = names.length;
}

/* ============================================================
   M-02 专注计时
   ============================================================ */
const focus = { total: 1500, left: 1500, running: false, id: null };

function fmtMMSS(sec) {
  return `${pad2(Math.floor(sec / 60))}:${pad2(Math.floor(sec % 60))}`;
}

function renderFocus() {
  $("#focusDigits").textContent = fmtMMSS(Math.max(0, focus.left));
  $("#focusBar").style.width =
    (focus.total ? (Math.max(0, focus.left) / focus.total) * 100 : 0) + "%";
  $("#focusToggle").textContent = focus.running ? "暂停" : focus.left === focus.total ? "开始专注" : "继续";
  /* 卡片预览 */
  $("#focusPreview").textContent = fmtMMSS(Math.max(0, focus.left));
  $("#focusPreviewBar").style.width =
    (focus.total ? (Math.max(0, focus.left) / focus.total) * 100 : 0) + "%";
  const done = todayCount("rhine.focusDone");
  $("#focusPreviewDone").textContent = done.n;
  $("#focusDone").textContent = done.n;
}

function focusStop() {
  focus.running = false;
  if (focus.id) { clearInterval(focus.id); focus.id = null; }
}

function focusStart() {
  if (focus.running) return;
  if (focus.left <= 0) focus.left = focus.total;
  focus.running = true;
  focus.id = setInterval(() => {
    focus.left -= 1;
    if (focus.left <= 0) {
      focus.left = 0;
      focusStop();
      beep();
      const n = bumpToday("rhine.focusDone");
      toast(`专注完成 · 今日第 ${n} 轮，休息一下吧。`, "ok");
      refreshStats();
    }
    renderFocus();
  }, 1000);
  renderFocus();
}

/* ============================================================
   M-03 掷骰子
   ============================================================ */
const dice = { count: 2, rolls: store.get("rhine.diceRolls", 0) };
const PIP_MAP = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8]
};

function buildDie(value) {
  const die = document.createElement("span");
  die.className = "die";
  for (let i = 0; i < 9; i++) {
    const pip = document.createElement("span");
    pip.className = "pip" + (PIP_MAP[value] && PIP_MAP[value].includes(i) ? " on" : "");
    die.appendChild(pip);
  }
  return die;
}

function renderDiceBoard(values) {
  const board = $("#diceBoard");
  board.innerHTML = "";
  (values || Array(dice.count).fill(1)).forEach((v) => board.appendChild(buildDie(v)));
  const sum = (values || []).reduce((a, b) => a + b, 0);
  $("#diceSum").textContent = values ? `合计 · ${sum}` : "等待投掷";
  $("#diceCount").textContent = `累计 ${dice.rolls} 次`;
  if (values) {
    $("#dicePreviewDie").textContent = values[0];
    $("#dicePreviewDie2").textContent = values[1] || "·";
  }
}

async function rollDice() {
  const board = $("#diceBoard");
  $$(".die", board).forEach((d) => d.classList.add("rolling"));
  await delay(480);
  const values = Array.from({ length: dice.count }, () => 1 + Math.floor(Math.random() * 6));
  renderDiceBoard(values);
  dice.rolls += 1;
  store.set("rhine.diceRolls", dice.rolls);
  $("#diceCount").textContent = `累计 ${dice.rolls} 次`;
  const sum = values.reduce((a, b) => a + b, 0);
  toast(`掷出 ${values.join("、")} · 合计 ${sum}`, "ok");
}

/* ============================================================
   M-04 速记板
   ============================================================ */
let noteSaveTimer = null;
function renderNotePreview() {
  const text = $("#noteText").value;
  const clean = text.trim().replace(/\s+/g, " ");
  $("#notePreview").textContent =
    clean ? (clean.length > 36 ? clean.slice(0, 36) + "…" : clean) : "暂无记录 —— 点击开始书写";
}
function saveNote() {
  const text = $("#noteText").value;
  store.set("rhine.note", text);
  $("#noteStatus").textContent = `已保存 ${nowTime()} · ${text.length} 字`;
}

/* ============================================================
   M-05 时钟与秒表
   ============================================================ */
const stopwatch = { running: false, startTs: 0, elapsed: 0, id: null };

function fmtStopwatch(ms) {
  const total = Math.floor(ms / 100);
  const min = Math.floor(total / 600);
  const sec = Math.floor((total % 600) / 10);
  const tenth = total % 10;
  return `${pad2(min)}:${pad2(sec)}.${tenth}`;
}

function renderClock() {
  const d = new Date();
  const time = nowTime();
  $("#headerClock").textContent = time;
  $("#clockPreview").textContent = time;
  $("#modalClockTime").textContent = time;
  const dateStr = `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
  const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  const dateFull = `${dateStr} 周${week}`;
  $("#clockPreviewDate").textContent = dateFull;
  $("#modalClockDate").textContent = dateFull;
  /* 当日进度 */
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const pct = Math.min(100, Math.max(0, ((Date.now() - start) / 86400000) * 100));
  $("#statDayBar").style.width = pct + "%";
  $("#dayBar").style.width = pct + "%";
  $("#statDayPct").textContent = `DAY PROGRESS · ${pct.toFixed(1)}%`;
  $("#dayPct").textContent = `DAY PROGRESS · ${pct.toFixed(1)}%`;
}

function renderStopwatch() {
  const ms = stopwatch.elapsed + (stopwatch.running ? Date.now() - stopwatch.startTs : 0);
  $("#stopDigits").textContent = fmtStopwatch(ms);
  $("#stopToggle").textContent = stopwatch.running ? "暂停" : stopwatch.elapsed ? "继续" : "开始";
}

function stopwatchTick() {
  renderStopwatch();
}

/* ============================================================
   统计 / 仪表盘
   ============================================================ */
function refreshStats() {
  const today = todayCount("rhine.today.decisions").n;
  $("#statToday").textContent = pad2(today);
  $("#statRuns").textContent = pad3(store.get("rhine.runs", 0));
  $("#statFocus").textContent = pad2(todayCount("rhine.focusDone").n);
}

/* ============================================================
   弹窗管理
   ============================================================ */
const MODAL_MAP = {
  random: "modalRandom",
  focus: "modalFocus",
  dice: "modalDice",
  note: "modalNote",
  clock: "modalClock"
};

let currentModal = null;

function openModal(name) {
  const id = MODAL_MAP[name];
  if (!id) {
    toast("该模块尚未接线 · 装配中，敬请期待。");
    return;
  }
  const el = document.getElementById(id);
  if (!el || currentModal === el) return;
  closeModal();
  currentModal = el;
  el.hidden = false;
  document.body.style.overflow = "hidden";
  const closeBtn = $(".close-btn", el);
  if (closeBtn) closeBtn.focus();
  onModalOpened(name);
}

function closeModal() {
  if (!currentModal) return;
  currentModal.hidden = true;
  currentModal = null;
  document.body.style.overflow = "";
  onModalClosed();
}

function onModalOpened(name) {
  if (name === "random") {
    renderCats();
    renderPresetPool();
    renderImportPool();
    refreshPoolUI();
    renderHistory();
    updateImportStatus(customPool.length ? `已载入 ${customPool.length} 项（本机会话保留）` : "未导入");
  }
  if (name === "focus") renderFocus();
  if (name === "dice") renderDiceBoard();
  if (name === "note") {
    $("#noteText").value = store.get("rhine.note", "");
    saveNote();
  }
  if (name === "clock") {
    renderClock();
    renderStopwatch();
  }
}

function onModalClosed() {
  /* 保持定时器运行：专注计时与秒表在后台继续 */
}

/* ---------- 事件绑定 ---------- */
document.addEventListener("DOMContentLoaded", () => {
  /* 弹窗开关 */
  $$("[data-module]").forEach((card) => {
    const name = card.dataset.module;
    const open = () => openModal(name);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
  $$("[data-open]").forEach((b) =>
    b.addEventListener("click", () => openModal(b.dataset.open))
  );
  $$("[data-scroll]").forEach((b) =>
    b.addEventListener("click", () => {
      const target = document.getElementById(b.dataset.scroll);
      if (target) target.scrollIntoView({ behavior: "smooth" });
    })
  );
  $$("[data-close]").forEach((el) => el.addEventListener("click", closeModal));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  /* —— 随机选择器 —— */
  $$(".tab[data-tab]").forEach((tab) =>
    tab.addEventListener("click", () => {
      $$(".tab[data-tab]").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      picker.tab = tab.dataset.tab;
      $$(".tabpane").forEach((p) =>
        p.classList.toggle("active", p.dataset.pane === picker.tab)
      );
      refreshPoolUI();
    })
  );

  $("#presetSelectAll").addEventListener("click", () => {
    FOOD_PRESETS.filter((f) => picker.catFilter === "all" || f.cat === picker.catFilter)
      .forEach((f) => presetSel.add(f.name));
    persistPools();
    renderPresetPool();
    refreshPoolUI();
    renderPreviewChips();
  });
  $("#presetClearAll").addEventListener("click", () => {
    FOOD_PRESETS.filter((f) => picker.catFilter === "all" || f.cat === picker.catFilter)
      .forEach((f) => presetSel.delete(f.name));
    persistPools();
    renderPresetPool();
    refreshPoolUI();
    renderPreviewChips();
  });

  /* 导入：文件 */
  const dz = $("#dropzone");
  const fileInput = $("#fileInput");
  $("#pickFile").addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.click();
  });
  dz.addEventListener("click", () => fileInput.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("dragover"); })
  );
  dz.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readFile(file);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) readFile(fileInput.files[0]);
    fileInput.value = "";
  });
  function readFile(file) {
    const reader = new FileReader();
    reader.onload = () => loadCustom(parseCustomText(reader.result), file.name);
    reader.onerror = () => toast("文件读取失败，请重试。", "err");
    reader.readAsText(file, "utf-8");
  }

  /* 导入：粘贴 */
  $("#parsePaste").addEventListener("click", () => {
    const items = parseCustomText($("#pasteArea").value);
    if (loadCustom(items, "粘贴文本")) $("#pasteArea").value = "";
  });

  $("#importSelectAll").addEventListener("click", () => {
    customSel = new Set(customPool);
    persistPools();
    renderImportPool();
    refreshPoolUI();
  });
  $("#importClear").addEventListener("click", () => {
    customPool = [];
    customSel = new Set();
    persistPools();
    renderImportPool();
    refreshPoolUI();
    updateImportStatus("未导入");
    toast("已清空导入名单。");
  });

  /* 抽取选项 */
  function clampQty() {
    const pool = activePool();
    const max = picker.noRepeat ? Math.min(10, Math.max(1, pool.length)) : 10;
    picker.qty = Math.min(picker.qty, max);
    refreshPoolUI();
  }
  $("#qtyMinus").addEventListener("click", () => {
    picker.qty = Math.max(1, picker.qty - 1);
    refreshPoolUI();
  });
  $("#qtyPlus").addEventListener("click", () => {
    picker.qty = Math.min(10, picker.qty + 1);
    clampQty();
  });

  function setSwitch(btn, on) {
    btn.setAttribute("aria-checked", on ? "true" : "false");
  }
  $("#allowRepeat").addEventListener("click", () => {
    picker.noRepeat = !picker.noRepeat;
    setSwitch($("#allowRepeat"), !picker.noRepeat);
    $("#repeatLabel").textContent = picker.noRepeat ? "去重" : "可重复";
    clampQty();
  });
  $("#consumeSwitch").addEventListener("click", () => {
    picker.consume = !picker.consume;
    setSwitch($("#consumeSwitch"), picker.consume);
    $("#consumeLabel").textContent = picker.consume ? "消耗" : "保留";
  });

  $("#execBtn").addEventListener("click", executeDraw);
  $("#rerollBtn").addEventListener("click", executeDraw);
  $("#clearHistBtn").addEventListener("click", () => {
    history = [];
    persistPools();
    renderHistory();
    toast("抽取历史已清空。");
  });

  /* —— 专注计时 —— */
  $$("#modalFocus .mini-btn[data-min]").forEach((b) =>
    b.addEventListener("click", () => {
      focusStop();
      focus.total = parseInt(b.dataset.min, 10) * 60;
      focus.left = focus.total;
      $$("#modalFocus .mini-btn[data-min]").forEach((x) => x.classList.toggle("active", x === b));
      renderFocus();
    })
  );
  $("#focusToggle").addEventListener("click", () => {
    if (focus.running) focusStop();
    else focusStart();
  });
  $("#focusReset").addEventListener("click", () => {
    focusStop();
    focus.left = focus.total;
    renderFocus();
  });

  /* —— 掷骰子 —— */
  $$("#modalDice .mini-btn[data-dice]").forEach((b) =>
    b.addEventListener("click", () => {
      dice.count = parseInt(b.dataset.dice, 10);
      $$("#modalDice .mini-btn[data-dice]").forEach((x) => x.classList.toggle("active", x === b));
      renderDiceBoard();
    })
  );
  $("#diceRoll").addEventListener("click", rollDice);

  /* —— 速记板 —— */
  $("#noteText").addEventListener("input", () => {
    renderNotePreview();
    clearTimeout(noteSaveTimer);
    noteSaveTimer = setTimeout(saveNote, 400);
  });
  $("#noteClear").addEventListener("click", () => {
    $("#noteText").value = "";
    saveNote();
    renderNotePreview();
    toast("速记内容已清空。");
  });

  /* —— 秒表 —— */
  $("#stopToggle").addEventListener("click", () => {
    if (stopwatch.running) {
      stopwatch.elapsed += Date.now() - stopwatch.startTs;
      stopwatch.running = false;
      clearInterval(stopwatch.id);
      stopwatch.id = null;
    } else {
      stopwatch.running = true;
      stopwatch.startTs = Date.now();
      stopwatch.id = setInterval(stopwatchTick, 100);
    }
    renderStopwatch();
  });
  $("#stopReset").addEventListener("click", () => {
    stopwatch.running = false;
    if (stopwatch.id) { clearInterval(stopwatch.id); stopwatch.id = null; }
    stopwatch.elapsed = 0;
    renderStopwatch();
  });

  /* —— 初始化 —— */
  renderPreviewChips();
  renderFocus();
  renderDiceBoard();
  renderNotePreview();
  refreshStats();
  renderClock();
  setInterval(renderClock, 1000);
  setInterval(refreshStats, 30000);
  updateImportStatus(customPool.length ? `已载入 ${customPool.length} 项（本机会话保留）` : "未导入");

  /* URL 参数直达：?open=random|focus|dice|note|clock（便于演示与截图） */
  const openParam = new URLSearchParams(location.search).get("open");
  if (openParam) openModal(openParam);
});
