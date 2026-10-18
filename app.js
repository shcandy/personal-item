/* ============================================================
   RHEIN TERMINAL · app.js
   模块工具台 —— 交互逻辑（苹果简约风）
   认证 / 云端清单 / 随机选择器 / 文章广场 / 其他模块
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
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 静默 */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* 静默 */ }
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
  if (diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
  const d = new Date(ts);
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

function toast(message, kind = "") {
  const root = $("#toastRoot");
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 240);
  }, 2600);
}

/* GitHub Pages 等静态托管页：提示去正式站点 */
function showStaticBanner() {
  const el = $("#staticBanner");
  if (el) el.hidden = false;
}

/* 当日计数 */
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

/* 两步确认按钮 */
function armButton(btn, label, action) {
  if (btn.dataset.armed === "1") {
    delete btn.dataset.armed;
    btn.classList.remove("confirming");
    btn.textContent = btn.dataset.original || btn.textContent;
    action();
    return;
  }
  btn.dataset.original = btn.textContent;
  btn.dataset.armed = "1";
  btn.classList.add("confirming");
  btn.textContent = label;
  setTimeout(() => {
    if (btn.dataset.armed === "1") {
      delete btn.dataset.armed;
      btn.classList.remove("confirming");
      btn.textContent = btn.dataset.original || btn.textContent;
    }
  }, 3000);
}

/* 音频提示 */
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
   认证与 API
   ============================================================ */
const savedAuth = store.get("rhine.auth", { token: "", username: "" });
const auth = {
  token: savedAuth.token || "",
  username: savedAuth.username || "",
  avatar: savedAuth.avatar || null
};
let serverOnline = true;
let authReturnTo = null; // 登录成功后的返回目标（模块名）

function isAuthed() { return Boolean(auth.token); }

/* 头像渲染：支持 emoji 或图片 data URL */
function paintAvatar(el, name, avatar) {
  if (!el) return;
  el.textContent = "";
  el.style.backgroundImage = "";
  el.style.backgroundSize = "";
  el.style.backgroundPosition = "";
  el.classList.remove("has-image");
  if (avatar && avatar.startsWith("data:image/")) {
    el.style.backgroundImage = `url("${avatar}")`;
    el.classList.add("has-image");
  } else if (avatar) {
    el.textContent = avatar;
  } else {
    el.textContent = (name || "访").slice(0, 1).toUpperCase();
  }
}

/* 个性化偏好：主题 / 强调色 / 阅读字体 / 动效 */
const THEME_KEY = "rhine.theme";
const ACCENT_KEY = "rhine.accent";
const READER_KEY = "rhine.reader";
const MOTION_KEY = "rhine.motion";
let themeMode = store.get(THEME_KEY, "system") || "system";

function systemPrefersDark() {
  try {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch (e) {
    return false;
  }
}
function syncSeg(containerSel, dataKey, value) {
  $$(containerSel + " .mini-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset[dataKey] === value);
  });
}
function applyTheme(mode) {
  themeMode = mode;
  const dark = mode === "dark" || (mode !== "light" && systemPrefersDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const btn = $("#themeBtn");
  if (btn) {
    btn.textContent = dark ? "☀️" : "🌙";
    btn.title = dark ? "切换到浅色" : "切换到深色";
    btn.setAttribute("aria-label", btn.title);
  }
  syncSeg("#themeSeg", "themeMode", mode);
}
function applyAccent(value) {
  document.documentElement.dataset.accent = value;
  $$("#accentRow .accent-dot").forEach((d) => {
    d.classList.toggle("active", d.dataset.accent === value);
  });
}
function applyReader(value) {
  document.documentElement.dataset.reader = value;
  syncSeg("#readerSeg", "reader", value);
}
function applyMotion(value) {
  document.documentElement.dataset.motion = value;
  syncSeg("#motionSeg", "motion", value);
}
function initPrefs() {
  applyTheme(themeMode);
  applyAccent(store.get(ACCENT_KEY, "blue") || "blue");
  applyReader(store.get(READER_KEY, "serif") || "serif");
  applyMotion(store.get(MOTION_KEY, "normal") || "normal");

  const btn = $("#themeBtn");
  if (btn) {
    btn.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      store.set(THEME_KEY, next);
      applyTheme(next);
    });
  }
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (themeMode === "system") applyTheme("system");
    });
  } catch (e) { /* 旧浏览器忽略 */ }
}

async function api(path, { method = "GET", body } = {}) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" }
  };
  if (auth.token) opts.headers.Authorization = "Bearer " + auth.token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    throw new Error("无法连接服务器，请确认已运行 node server.js");
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* 无 JSON 体 */ }
  if (res.status === 401 && auth.token) {
    // 会话过期
    clearAuth();
    toast("登录已过期，请重新登录", "err");
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || "HTTP " + res.status);
    err.status = res.status;
    throw err;
  }
  return data;
}

function setAuth(token, username, avatar) {
  auth.token = token;
  auth.username = username;
  auth.avatar = avatar || null;
  store.set("rhine.auth", { token, username, avatar: auth.avatar });
  renderUserUI();
  renderSheetsGuest();
  refreshPlazaCard();
  if (currentModal && currentModal.id === "modalPlaza") refreshPlaza();
}

function clearAuth() {
  auth.token = "";
  auth.username = "";
  auth.avatar = null;
  store.set("rhine.auth", { token: "", username: "", avatar: null });
  sheets.state.list = [];
  sheets.state.activeId = null;
  sheets.state.items = [];
  renderUserUI();
  renderSheetsGuest();
  refreshPlazaCard();
  if (currentModal && currentModal.id === "modalPlaza") refreshPlaza();
}

function renderUserUI() {
  const logged = isAuthed();
  paintAvatar($("#avatar"), logged ? auth.username : "访", logged ? auth.avatar : null);
  paintAvatar($("#popAvatar"), logged ? auth.username : "访", logged ? auth.avatar : null);
  $("#userName").textContent = logged ? auth.username : "登录";
  $("#popName").textContent = logged ? auth.username : "未登录";
  $("#popSub").textContent = logged ? "清单与文章已同步至该账号" : "登录后可同步清单与文章";
}

/* 服务端刷新头像（登录后调用） */
async function refreshProfile() {
  if (!isAuthed()) return;
  try {
    const data = await api("/api/me");
    if (data && data.avatar !== undefined) {
      auth.avatar = data.avatar || null;
      store.set("rhine.auth", { token: auth.token, username: auth.username, avatar: auth.avatar });
      renderUserUI();
      paintAvatar($("#avatarPreview"), auth.username, auth.avatar);
    }
  } catch (e) { /* 忽略 */ }
}

/* ---------- 自定义头像 ---------- */
const AVATAR_PRESETS = ["🦉", "🦊", "🐼", "🐧", "🐱", "🐸", "🌙", "⭐", "🍀", "🔭", "🧪", "🛰️"];

function openAvatarModal() {
  closePopover();
  renderAvatarPicker();
  openModal("avatar");
}

function renderAvatarPicker() {
  const grid = $("#avatarGrid");
  if (!grid) return;
  setCropMode(false);
  grid.innerHTML = "";
  AVATAR_PRESETS.forEach((emoji) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "avatar-opt" + (auth.avatar === emoji ? " active" : "");
    b.textContent = emoji;
    b.addEventListener("click", () => saveAvatar(emoji));
    grid.appendChild(b);
  });
  paintAvatar($("#avatarPreview"), auth.username || "访", auth.avatar);
}

async function saveAvatar(value) {
  if (!isAuthed()) {
    toast("请先登录", "err");
    return;
  }
  try {
    const data = await api("/api/me/avatar", { method: "PUT", body: { avatar: value } });
    auth.avatar = data.avatar || null;
    store.set("rhine.auth", { token: auth.token, username: auth.username, avatar: auth.avatar });
    renderUserUI();
    renderAvatarPicker();
    toast(value ? "头像已更新" : "已恢复默认头像", "ok");
  } catch (e) {
    toast(e.message, "err");
  }
}

/* ---------- 头像取景裁剪 ---------- */
const crop = {
  img: null,
  url: null,
  W: 0,
  H: 0,
  view: 260,
  scale0: 1,
  zoom: 1,
  tx: 0,
  ty: 0,
  dragging: false,
  lastX: 0,
  lastY: 0
};

function setCropMode(on) {
  const cropEl = $("#avatarCrop");
  const grid = $("#avatarGrid");
  const actions = $("#avatarActions");
  if (!cropEl) return;
  cropEl.hidden = !on;
  grid.hidden = on;
  actions.hidden = on;
}

function openCropWithFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    toast("请选择图片文件", "err");
    return;
  }
  if (crop.url) URL.revokeObjectURL(crop.url);
  crop.url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    crop.img = img;
    crop.W = img.naturalWidth || img.width;
    crop.H = img.naturalHeight || img.height;
    /* 先显示取景区域，再测量宽度（隐藏元素宽度为 0） */
    setCropMode(true);
    const viewport = $("#cropViewport");
    crop.view = (viewport && viewport.clientWidth) || 260;
    crop.scale0 = Math.max(crop.view / crop.W, crop.view / crop.H);
    crop.zoom = 1;
    crop.tx = (crop.view - crop.W * crop.scale0) / 2;
    crop.ty = (crop.view - crop.H * crop.scale0) / 2;
    const imgEl = $("#cropImage");
    imgEl.src = crop.url;
    $("#cropZoom").value = "1";
    layoutCrop();
  };
  img.onerror = () => toast("图片读取失败，请换一张试试", "err");
  img.src = crop.url;
}

function layoutCrop() {
  if (!crop.img) return;
  const s = crop.scale0 * crop.zoom;
  const w = crop.W * s;
  const h = crop.H * s;
  /* 约束：图片始终覆盖取景框 */
  crop.tx = Math.min(0, Math.max(crop.view - w, crop.tx));
  crop.ty = Math.min(0, Math.max(crop.view - h, crop.ty));
  const imgEl = $("#cropImage");
  imgEl.style.width = w + "px";
  imgEl.style.height = h + "px";
  imgEl.style.left = crop.tx + "px";
  imgEl.style.top = crop.ty + "px";

  /* 实时预览：把取景框内容映射到 76px 预览圆 */
  const preview = $("#avatarPreview");
  const pv = 76;
  const ratio = pv / crop.view;
  preview.style.backgroundImage = `url("${crop.url}")`;
  preview.style.backgroundSize = `${w * ratio}px ${h * ratio}px`;
  preview.style.backgroundPosition = `${crop.tx * ratio}px ${crop.ty * ratio}px`;
  preview.textContent = "";
  preview.classList.add("has-image");
}

function saveCroppedAvatar() {
  if (!crop.img) return;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    toast("当前浏览器不支持图片处理", "err");
    return;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const ratio = size / crop.view;
  const s = crop.scale0 * crop.zoom;
  ctx.drawImage(crop.img, crop.tx * ratio, crop.ty * ratio, crop.W * s * ratio, crop.H * s * ratio);
  let dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  if (dataUrl.length > 110000) dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  if (dataUrl.length > 110000) dataUrl = canvas.toDataURL("image/jpeg", 0.55);
  setCropMode(false);
  saveAvatar(dataUrl);
}

function cancelCrop() {
  setCropMode(false);
  paintAvatar($("#avatarPreview"), auth.username || "访", auth.avatar);
}

async function checkHealth() {
  try {
    await api("/api/health");
    serverOnline = true;
    const chip = $("#serverChip");
    chip.textContent = "● 在线服务";
    chip.classList.add("online");
  } catch (e) {
    serverOnline = false;
    const chip = $("#serverChip");
    chip.textContent = "● 本地模式";
    chip.classList.remove("online");
    if (location.hostname.endsWith("github.io")) showStaticBanner();
  }
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
  { id: "rice", label: "饭" },
  { id: "noodle", label: "面" },
  { id: "light", label: "轻食" },
  { id: "pot", label: "汤锅" },
  { id: "snack", label: "小食" }
];

const picker = {
  tab: "preset",
  catFilter: "all",
  qty: 1,
  noRepeat: true,
  consume: false,
  running: false
};

let presetSel = new Set(store.get("rhine.presetSel", null) || FOOD_PRESETS.map((f) => f.name));
let tempItems = store.get("rhine.tempItems", []);
let history = store.get("rhine.history", []);

const sheets = {
  state: { list: [], activeId: null, items: [] }
};

function persistPools() {
  store.set("rhine.presetSel", Array.from(presetSel));
  store.set("rhine.tempItems", tempItems);
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
    btn.innerHTML = `<span class="tick">✓</span><span class="chip-name">${escapeHtml(f.name)}</span>`;
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

/* —— 渲染：临时导入池（不可一键清空，仅支持逐项移除） —— */
function renderImportPool() {
  const wrap = $("#importPool");
  wrap.innerHTML = "";
  if (!tempItems.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "暂无导入项 —— 通过上方拖放或粘贴载入名单。";
    wrap.appendChild(empty);
  }
  tempItems.forEach((name, i) => {
    const btn = document.createElement("button");
    btn.className = "item-chip";
    btn.innerHTML =
      `<span class="tick">✓</span><span class="chip-name">${escapeHtml(name)}</span>
       <span class="del" title="移除这一项">✕</span>`;
    btn.addEventListener("click", (e) => {
      if (e.target.classList.contains("del")) {
        tempItems.splice(i, 1);
        persistPools();
        renderImportPool();
        refreshPoolUI();
        updateImportStatus(`当前名单 ${tempItems.length} 项 · 已移除「${name}」`);
        return;
      }
    });
    wrap.appendChild(btn);
  });
  $("#importCount").textContent = `名单 ${tempItems.length} 项`;
}

function updateImportStatus(text) {
  $("#importStatus").textContent = `当前名单：${text}`;
}

/* —— 云端清单 —— */
async function loadSheets() {
  if (!isAuthed()) return;
  try {
    const data = await api("/api/sheets");
    sheets.state.list = data.sheets;
    if (sheets.state.activeId && !sheets.state.list.some((s) => s.id === sheets.state.activeId)) {
      sheets.state.activeId = null;
      sheets.state.items = [];
    }
    renderSheetTabs();
    if (sheets.state.activeId) await selectSheet(sheets.state.activeId, true);
    else renderSheetPool();
  } catch (e) {
    toast(e.message, "err");
  }
}

function renderSheetTabs() {
  const wrap = $("#sheetTabs");
  wrap.innerHTML = "";
  if (!sheets.state.list.length) {
    const empty = document.createElement("span");
    empty.className = "pool-count mono";
    empty.textContent = "还没有清单，点击「＋ 新建」创建一个";
    wrap.appendChild(empty);
    return;
  }
  sheets.state.list.forEach((s) => {
    const b = document.createElement("button");
    b.className = "sheet-tab" + (s.id === sheets.state.activeId ? " active" : "");
    b.innerHTML = `${escapeHtml(s.name)}<span class="count">${s.count}</span>`;
    b.addEventListener("click", () => selectSheet(s.id));
    wrap.appendChild(b);
  });
}

async function selectSheet(id, keepItems) {
  sheets.state.activeId = id;
  try {
    const data = await api("/api/sheets/" + id);
    sheets.state.items = data.items;
    renderSheetTabs();
    renderSheetPool();
    refreshPoolUI();
  } catch (e) {
    toast(e.message, "err");
  }
}

function renderSheetPool() {
  const wrap = $("#sheetPool");
  wrap.innerHTML = "";
  const items = sheets.state.items;
  if (!sheets.state.activeId) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "选择一个清单后，这里会显示其中的选项。";
    wrap.appendChild(empty);
    $("#sheetCount").textContent = "未选择清单";
    return;
  }
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty-note";
    empty.textContent = "这个清单还是空的，在下方输入框添加选项。";
    wrap.appendChild(empty);
  }
  items.forEach((name, i) => {
    const btn = document.createElement("button");
    btn.className = "item-chip";
    btn.innerHTML =
      `<span class="tick">✓</span><span class="chip-name">${escapeHtml(name)}</span>
       <span class="del" title="从清单移除">✕</span>`;
    btn.addEventListener("click", async (e) => {
      if (!e.target.classList.contains("del")) return;
      const next = items.filter((x, idx) => idx !== i);
      try {
        await api("/api/sheets/" + sheets.state.activeId, { method: "PUT", body: { items: next } });
        sheets.state.items = next;
        const s = sheets.state.list.find((x) => x.id === sheets.state.activeId);
        if (s) s.count = next.length;
        renderSheetPool();
        renderSheetTabs();
        refreshPoolUI();
      } catch (err) {
        toast(err.message, "err");
      }
    });
    wrap.appendChild(btn);
  });
  const s = sheets.state.list.find((x) => x.id === sheets.state.activeId);
  $("#sheetCount").textContent = `清单「${s ? s.name : ""}」 · ${items.length} 项`;
}

function renderSheetsGuest() {
  const guest = $("#sheetsGuest");
  const main = $("#sheetsMain");
  if (isAuthed()) {
    guest.hidden = true;
    main.hidden = false;
    loadSheets();
  } else {
    guest.hidden = false;
    main.hidden = true;
  }
}

/* —— 活动池 —— */
function activePool() {
  if (picker.tab === "preset") {
    return FOOD_PRESETS.filter((f) => presetSel.has(f.name)).map((f) => f.name);
  }
  if (picker.tab === "sheets") {
    return sheets.state.items.slice();
  }
  return tempItems.slice();
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

  const totalMs = 900;
  const start = performance.now();
  await new Promise((resolve) => {
    const step = (now) => {
      const p = Math.min(1, (now - start) / totalMs);
      reel.textContent = pool[Math.floor(Math.random() * pool.length)];
      if (p < 1) {
        const wait = 45 + 190 * p * p;
        setTimeout(() => requestAnimationFrame(step), wait);
      } else resolve();
    };
    requestAnimationFrame(step);
  });
  await delay(120);

  grid.innerHTML = "";
  items.forEach((name, i) => {
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML =
      `<div class="r-idx">NO.${pad2(i + 1)}</div>
       <div class="r-name">${escapeHtml(name)}</div>
       <div class="r-tag">RHEIN PICK</div>`;
    grid.appendChild(card);
  });

  /* 消耗：从来源池移除 */
  if (picker.consume) {
    if (picker.tab === "preset") {
      items.forEach((name) => presetSel.delete(name));
      persistPools();
      renderPresetPool();
    } else if (picker.tab === "sheets") {
      const next = sheets.state.items.filter((x) => !items.includes(x));
      try {
        await api("/api/sheets/" + sheets.state.activeId, { method: "PUT", body: { items: next } });
        sheets.state.items = next;
        const s = sheets.state.list.find((x) => x.id === sheets.state.activeId);
        if (s) s.count = next.length;
        renderSheetPool();
        renderSheetTabs();
      } catch (e) {
        toast(e.message, "err");
      }
    } else {
      tempItems = tempItems.filter((x) => !items.includes(x));
      persistPools();
      renderImportPool();
      updateImportStatus(`当前名单 ${tempItems.length} 项 · 已消耗 ${items.length} 项`);
    }
  }

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
    } catch (e) { /* 继续按文本解析 */ }
  }

  const lines = t.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

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
  tempItems = clean.slice();
  persistPools();
  renderImportPool();
  refreshPoolUI();
  updateImportStatus(`${clean.length} 项 · 来源：${sourceLabel} · 仅支持逐项移除`);
  toast(`名单载入完成：${clean.length} 项`, "ok");
  return true;
}

/* ============================================================
   M-06 文章广场
   ============================================================ */
const plaza = {
  state: { list: [], filter: "all", view: "list", current: null, editingId: null, comments: [] }
};
let plazaPoll = null;

async function loadArticles() {
  if (!isAuthed()) return;
  try {
    const data = await api("/api/articles");
    plaza.state.list = data.articles;
    renderPlazaList();
    refreshPlazaCard();
  } catch (e) {
    toast(e.message, "err");
  }
}

function renderPlazaList() {
  const listEl = $("#plazaList");
  const empty = $("#plazaEmpty");
  listEl.innerHTML = "";
  const mine = plaza.state.filter === "mine";
  const rows = plaza.state.list.filter((a) => (mine ? a.username === auth.username : true));
  empty.hidden = rows.length > 0;
  rows.forEach((a) => {
    const row = document.createElement("button");
    row.className = "article-row";
    row.innerHTML =
      `<div class="a-title">${escapeHtml(a.title)}</div>
       <div class="a-meta">
         <span class="badge ${a.isPublic ? "public" : "private"}">${a.isPublic ? "圈子可见" : "私密"}</span>
         <span>${escapeHtml(a.username)}</span>
         <span>${timeAgo(a.updatedAt)}</span>
         <span>${a.commentCount || 0} 评论</span>
       </div>
       <div class="a-excerpt">${escapeHtml(a.excerpt || "")}</div>`;
    row.addEventListener("click", () => openArticle(a.id));
    listEl.appendChild(row);
  });
}

async function openArticle(id) {
  try {
    const data = await api("/api/articles/" + id);
    plaza.state.current = data.article;
    plaza.state.view = "read";
    $("#commentInput").value = "";
    renderPlazaView();
    await loadComments(id);
  } catch (e) {
    toast(e.message, "err");
  }
}

/* —— 评论（登录后可用） —— */
async function loadComments(articleId) {
  try {
    const data = await api(`/api/articles/${articleId}/comments`);
    plaza.state.comments = data.comments || [];
  } catch (e) {
    plaza.state.comments = [];
  }
  renderComments();
}

function renderComments() {
  const list = $("#commentList");
  list.innerHTML = "";
  const cs = plaza.state.comments || [];
  $("#commentsLabel").textContent = `COMMENTS · 评论 ${cs.length}`;
  $("#commentEmpty").hidden = cs.length > 0;
  cs.forEach((c) => {
    const li = document.createElement("div");
    li.className = "comment-item";
    const del = c.mine
      ? `<button class="c-del" data-id="${escapeHtml(c.id)}">删除</button>`
      : "";
    li.innerHTML =
      `<div class="c-head">
         <span class="c-name">${escapeHtml(c.username)}</span>
         <span>${timeAgo(c.createdAt)}</span>
         ${del}
       </div>
       <div class="c-content">${escapeHtml(c.content)}</div>`;
    if (c.mine) {
      const btn = $(".c-del", li);
      btn.addEventListener("click", () => {
        armButton(btn, "再点一次确认", async () => {
          try {
            await api(`/api/comments/${c.id}`, { method: "DELETE" });
            plaza.state.comments = plaza.state.comments.filter((x) => x.id !== c.id);
            if (plaza.state.current) plaza.state.current.commentCount = Math.max(0, (plaza.state.current.commentCount || 0) - 1);
            renderComments();
            toast("评论已删除", "ok");
          } catch (err) {
            toast(err.message, "err");
          }
        });
      });
    }
    list.appendChild(li);
  });
}

async function sendComment() {
  const content = $("#commentInput").value.trim();
  if (!content) {
    toast("评论不能为空", "err");
    return;
  }
  if (!plaza.state.current) return;
  try {
    const data = await api(`/api/articles/${plaza.state.current.id}/comments`, {
      method: "POST",
      body: { content }
    });
    plaza.state.comments.push(data.comment);
    if (plaza.state.current) plaza.state.current.commentCount = (plaza.state.current.commentCount || 0) + 1;
    $("#commentInput").value = "";
    renderComments();
    toast("评论已发表", "ok");
  } catch (e) {
    toast(e.message, "err");
  }
}

function renderPlazaView() {
  const main = $("#plazaMain");
  const reader = $("#plazaReader");
  const editor = $("#plazaEditor");
  /* 已登录时锁定视图永远不显示，避免残留 */
  $("#plazaLock").hidden = isAuthed();
  main.hidden = plaza.state.view !== "list";
  reader.hidden = plaza.state.view !== "read";
  editor.hidden = plaza.state.view !== "editor";
  if (plaza.state.view === "read" && plaza.state.current) {
    const a = plaza.state.current;
    $("#readerTitle").textContent = a.title;
    $("#readerMeta").textContent =
      `${a.isPublic ? "圈子可见" : "私密"} · ${a.username} · ${timeAgo(a.updatedAt)} · ${a.content.length} 字 · ${a.commentCount || 0} 评论`;
    $("#readerBody").textContent = a.content;
    $("#readerActions").hidden = a.username !== auth.username;
    renderComments();
  }
}

function openEditor(article) {
  plaza.state.view = "editor";
  plaza.state.editingId = article ? article.id : null;
  $("#editorTitle").value = article ? article.title : "";
  $("#editorContent").value = article ? article.content : "";
  setEditorPublic(article ? article.isPublic : false);
  $("#editorStatus").textContent = "";
  renderPlazaView();
  $("#editorTitle").focus();
}

function setEditorPublic(on) {
  const pubBtn = $("#editorPublic");
  const privBtn = $("#editorPrivate");
  pubBtn.setAttribute("aria-checked", on ? "true" : "false");
  pubBtn.classList.toggle("active", on);
  privBtn.classList.toggle("active", !on);
  $("#editorPublicLabel").textContent = on
    ? "圈子可见：所有受邀成员都能看到这篇文章。"
    : "仅自己可见：只有你能看到这篇文章。";
}

async function saveArticle() {
  const title = $("#editorTitle").value.trim();
  const content = $("#editorContent").value;
  const isPublic = $("#editorPublic").getAttribute("aria-checked") === "true";
  if (!title) { toast("请填写标题", "err"); return; }
  if (!content.trim()) { toast("正文不能为空", "err"); return; }
  try {
    if (plaza.state.editingId) {
      await api("/api/articles/" + plaza.state.editingId, { method: "PUT", body: { title, content, isPublic } });
      toast("文章已更新", "ok");
    } else {
      await api("/api/articles", { method: "POST", body: { title, content, isPublic } });
      toast(isPublic ? "文章已发布（公开）" : "文章已保存（仅自己可见）", "ok");
    }
    await loadArticles();
    plaza.state.view = "list";
    renderPlazaView();
  } catch (e) {
    toast(e.message, "err");
  }
}

function refreshPlaza() {
  if (isAuthed()) {
    $("#plazaLock").hidden = true;
    $("#plazaMain").hidden = plaza.state.view !== "list";
    $("#plazaReader").hidden = plaza.state.view !== "read";
    $("#plazaEditor").hidden = plaza.state.view !== "editor";
    plaza.state.view = "list";
    loadArticles();
  } else {
    $("#plazaLock").hidden = false;
    $("#plazaMain").hidden = true;
    $("#plazaReader").hidden = true;
    $("#plazaEditor").hidden = true;
  }
}

function refreshPlazaCard() {
  if (isAuthed()) {
    $("#plazaPreview").textContent = "写下你的文字，公开或只留给自己。";
    $("#plazaPreviewCount").textContent = `已登录 · ${plaza.state.list.length} 篇可见文章`;
  } else {
    $("#plazaPreview").textContent = "登录后即可阅读与写作";
    $("#plazaPreviewCount").textContent = "未登录 · 全部私密";
  }
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
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const pct = Math.min(100, Math.max(0, ((Date.now() - start) / 86400000) * 100));
  $("#dayBar").style.width = pct + "%";
  $("#dayPct").textContent = `DAY PROGRESS · ${pct.toFixed(1)}%`;
  $("#statDayPct").textContent = pct.toFixed(1) + "%";
}

function renderStopwatch() {
  const ms = stopwatch.elapsed + (stopwatch.running ? Date.now() - stopwatch.startTs : 0);
  $("#stopDigits").textContent = fmtStopwatch(ms);
  $("#stopToggle").textContent = stopwatch.running ? "暂停" : stopwatch.elapsed ? "继续" : "开始";
}

/* ============================================================
   统计
   ============================================================ */
function refreshStats() {
  $("#statToday").textContent = pad2(todayCount("rhine.today.decisions").n);
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
  clock: "modalClock",
  plaza: "modalPlaza",
  auth: "modalAuth",
  avatar: "modalAvatar",
  settings: "modalSettings"
};
const MODAL_NAME = Object.fromEntries(Object.entries(MODAL_MAP).map(([k, v]) => [v, k]));

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
  if (currentModal.id === "modalAvatar") setCropMode(false);
  currentModal.hidden = true;
  currentModal = null;
  document.body.style.overflow = "";
  closePopover();
  if (plazaPoll) {
    clearInterval(plazaPoll);
    plazaPoll = null;
  }
}

function openAuthFrom(name) {
  authReturnTo = name;
  resetAuthForm();
  openModal("auth");
}

function onModalOpened(name) {
  if (name === "random") {
    renderCats();
    renderPresetPool();
    renderSheetsGuest();
    renderImportPool();
    refreshPoolUI();
    renderHistory();
    updateImportStatus(tempItems.length ? `${tempItems.length} 项（仅支持逐项移除）` : "未导入");
  }
  if (name === "sheets") { /* 不单独存在 */ }
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
  if (name === "plaza") {
    refreshPlaza();
    /* 小圈子信息板机制：广场开启时每 10 秒静默同步一次列表 */
    if (plazaPoll) clearInterval(plazaPoll);
    plazaPoll = setInterval(() => {
      if (plaza.state.view === "list" && isAuthed()) loadArticles();
    }, 10000);
  }
  if (name === "avatar") renderAvatarPicker();
  if (name === "settings") {
    applyTheme(themeMode);
    applyAccent(store.get(ACCENT_KEY, "blue") || "blue");
    applyReader(store.get(READER_KEY, "serif") || "serif");
    applyMotion(store.get(MOTION_KEY, "normal") || "normal");
  }
}

/* 账号弹层 */
function togglePopover() {
  const pop = $("#accountPop");
  if (pop.hidden) {
    renderUserUI();
    pop.hidden = false;
  } else {
    pop.hidden = true;
  }
}
function closePopover() {
  $("#accountPop").hidden = true;
}

/* 认证表单 */
let authMode = "login";
function resetAuthForm() {
  authMode = "login";
  $("#authTitle").textContent = "登录";
  $("#authSub").textContent = "登录后，清单与文章将随账号同步。";
  $("#authSubmit").textContent = "登录";
  $("#authSwitch").textContent = "立即注册";
  $("#authInviteBox").hidden = true;
  $("#authInvite").value = "";
  $("#authError").hidden = true;
  $("#authError").textContent = "";
}
function setAuthMode(mode) {
  authMode = mode;
  if (mode === "register") {
    $("#authTitle").textContent = "创建账号";
    $("#authSub").textContent = "站点为邀请制：注册需要一次性邀请码，可向圈主索取。";
    $("#authSubmit").textContent = "注册";
    $("#authSwitch").textContent = "已有账号？去登录";
    $("#authInviteBox").hidden = false;
  } else {
    $("#authTitle").textContent = "登录";
    $("#authSub").textContent = "登录后，清单与文章将随账号同步。";
    $("#authSubmit").textContent = "登录";
    $("#authSwitch").textContent = "立即注册";
    $("#authInviteBox").hidden = true;
  }
}
async function submitAuth() {
  const username = $("#authUser").value.trim();
  const password = $("#authPass").value;
  const errEl = $("#authError");
  if (!username || !password) {
    errEl.textContent = "请填写用户名和密码";
    errEl.hidden = false;
    return;
  }
  if (password.length < 6) {
    errEl.textContent = "密码至少 6 位";
    errEl.hidden = false;
    return;
  }
  let inviteCode = "";
  if (authMode === "register") {
    inviteCode = $("#authInvite").value.trim();
    if (!inviteCode) {
      errEl.textContent = "请填写邀请码（向圈主索取）";
      errEl.hidden = false;
      return;
    }
  }
  errEl.hidden = true;
  $("#authSubmit").disabled = true;
  try {
    const path = authMode === "register" ? "/api/register" : "/api/login";
    const payload = { username, password };
    if (authMode === "register") payload.inviteCode = inviteCode;
    const data = await api(path, { method: "POST", body: payload });
    setAuth(data.token, data.username);
    refreshProfile();
    toast(authMode === "register" ? `欢迎，${data.username}！` : `欢迎回来，${data.username}`, "ok");
    $("#authUser").value = "";
    $("#authPass").value = "";
    closeModal();
    if (authReturnTo) {
      const back = authReturnTo;
      authReturnTo = null;
      openModal(back);
    }
    checkHealth();
  } catch (e) {
    if (e.status === 405) {
      errEl.innerHTML =
        '当前是 GitHub Pages 静态展示页，无法登录。请前往 ' +
        '<a href="https://rhine-terminal.onrender.com" target="_blank" rel="noopener">正式站点 rhine-terminal.onrender.com</a>。';
      showStaticBanner();
    } else {
      errEl.textContent = e.message;
    }
    errEl.hidden = false;
  } finally {
    $("#authSubmit").disabled = false;
  }
}

/* ---------- 事件绑定 ---------- */
document.addEventListener("DOMContentLoaded", () => {
  /* 模块卡片与通用按钮 */
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
  $$("[data-open-auth]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      openAuthFrom(currentModal ? MODAL_NAME[currentModal.id] : null);
    })
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

  /* 顶栏用户 */
  $("#userBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    if (isAuthed()) togglePopover();
    else openAuthFrom(null);
  });
  $("#logoutBtn").addEventListener("click", async () => {
    try { await api("/api/logout", { method: "POST" }); } catch (e) { /* 忽略 */ }
    clearAuth();
    closePopover();
    toast("已退出登录");
  });
  $("#avatarBtn").addEventListener("click", openAvatarModal);
  $("#avatarReset").addEventListener("click", () => saveAvatar(null));
  $("#avatarFile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) openCropWithFile(file);
    e.target.value = "";
  });

  /* 头像取景：拖动 + 缩放 */
  const viewport = $("#cropViewport");
  viewport.addEventListener("pointerdown", (e) => {
    if (!crop.img) return;
    crop.dragging = true;
    crop.lastX = e.clientX;
    crop.lastY = e.clientY;
    try { viewport.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!crop.dragging) return;
    crop.tx += e.clientX - crop.lastX;
    crop.ty += e.clientY - crop.lastY;
    crop.lastX = e.clientX;
    crop.lastY = e.clientY;
    layoutCrop();
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
    viewport.addEventListener(ev, () => { crop.dragging = false; })
  );
  $("#cropZoom").addEventListener("input", (e) => {
    if (!crop.img) return;
    const next = parseFloat(e.target.value) || 1;
    const factor = next / crop.zoom;
    const cx = crop.view / 2;
    const cy = crop.view / 2;
    crop.tx = cx - (cx - crop.tx) * factor;
    crop.ty = cy - (cy - crop.ty) * factor;
    crop.zoom = next;
    layoutCrop();
  });
  $("#cropSave").addEventListener("click", saveCroppedAvatar);
  $("#cropCancel").addEventListener("click", cancelCrop);

  /* 个性化设置 */
  const openSettings = () => openModal("settings");
  $("#settingsBtn").addEventListener("click", openSettings);
  $("#settingsFromPopBtn").addEventListener("click", () => {
    closePopover();
    openSettings();
  });
  $("#themeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme-mode]");
    if (!b) return;
    store.set(THEME_KEY, b.dataset.themeMode);
    applyTheme(b.dataset.themeMode);
  });
  $("#accentRow").addEventListener("click", (e) => {
    const d = e.target.closest("[data-accent]");
    if (!d) return;
    store.set(ACCENT_KEY, d.dataset.accent);
    applyAccent(d.dataset.accent);
  });
  $("#readerSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-reader]");
    if (!b) return;
    store.set(READER_KEY, b.dataset.reader);
    applyReader(b.dataset.reader);
  });
  $("#motionSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-motion]");
    if (!b) return;
    store.set(MOTION_KEY, b.dataset.motion);
    applyMotion(b.dataset.motion);
  });
  $("#settingsAvatarBtn").addEventListener("click", () => {
    closeModal();
    openAvatarModal();
  });
  document.addEventListener("click", (e) => {
    const pop = $("#accountPop");
    if (!pop.hidden && !pop.contains(e.target) && e.target !== $("#userBtn")) pop.hidden = true;
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

  /* 云端清单 */
  $("#sheetNewBtn").addEventListener("click", () => {
    $("#newSheetBox").hidden = false;
    $("#renameBox").hidden = true;
    $("#newSheetName").focus();
  });
  $("#newSheetCancel").addEventListener("click", () => { $("#newSheetBox").hidden = true; });
  $("#newSheetSave").addEventListener("click", async () => {
    const name = $("#newSheetName").value.trim();
    if (!name) { toast("请填写清单名称", "err"); return; }
    const items = $("#newSheetItems").value
      .split(/\n+/).map((s) => s.trim()).filter(Boolean);
    try {
      const data = await api("/api/sheets", { method: "POST", body: { name, items } });
      $("#newSheetBox").hidden = true;
      $("#newSheetName").value = "";
      $("#newSheetItems").value = "";
      await loadSheets();
      await selectSheet(data.sheet.id);
      toast(`清单「${name}」已创建`, "ok");
    } catch (e) {
      toast(e.message, "err");
    }
  });
  $("#renameCancel").addEventListener("click", () => { $("#renameBox").hidden = true; });
  $("#sheetRenameBtn").addEventListener("click", () => {
    if (!sheets.state.activeId) { toast("请先选择一个清单", "err"); return; }
    const s = sheets.state.list.find((x) => x.id === sheets.state.activeId);
    $("#renameInput").value = s ? s.name : "";
    $("#renameBox").hidden = false;
    $("#newSheetBox").hidden = true;
    $("#renameInput").focus();
  });
  $("#renameSave").addEventListener("click", async () => {
    const name = $("#renameInput").value.trim();
    if (!name) { toast("请填写清单名称", "err"); return; }
    try {
      await api("/api/sheets/" + sheets.state.activeId, { method: "PUT", body: { name } });
      const s = sheets.state.list.find((x) => x.id === sheets.state.activeId);
      if (s) s.name = name;
      renderSheetTabs();
      renderSheetPool();
      $("#renameBox").hidden = true;
      toast("清单已重命名", "ok");
    } catch (e) {
      toast(e.message, "err");
    }
  });
  $("#sheetDeleteBtn").addEventListener("click", (e) => {
    if (!sheets.state.activeId) { toast("请先选择一个清单", "err"); return; }
    armButton(e.currentTarget, "再点一次确认删除", async () => {
      try {
        const id = sheets.state.activeId;
        await api("/api/sheets/" + id, { method: "DELETE" });
        sheets.state.activeId = null;
        sheets.state.items = [];
        await loadSheets();
        renderSheetPool();
        refreshPoolUI();
        toast("清单已删除", "ok");
      } catch (err) {
        toast(err.message, "err");
      }
    });
  });
  $("#sheetAddBtn").addEventListener("click", async () => {
    if (!sheets.state.activeId) { toast("请先选择一个清单", "err"); return; }
    const text = $("#sheetAddInput").value.trim();
    if (!text) return;
    if (sheets.state.items.includes(text)) { toast("该选项已存在", "err"); return; }
    const next = sheets.state.items.concat([text]);
    try {
      await api("/api/sheets/" + sheets.state.activeId, { method: "PUT", body: { items: next } });
      sheets.state.items = next;
      const s = sheets.state.list.find((x) => x.id === sheets.state.activeId);
      if (s) s.count = next.length;
      $("#sheetAddInput").value = "";
      renderSheetPool();
      renderSheetTabs();
      refreshPoolUI();
    } catch (e) {
      toast(e.message, "err");
    }
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

  /* 存为我的清单 */
  $("#saveToSheetBtn").addEventListener("click", () => {
    if (!isAuthed()) { openAuthFrom("random"); return; }
    if (!tempItems.length) { toast("临时名单为空", "err"); return; }
    $("#saveSheetInput").value = "";
    $("#saveSheetBox").hidden = false;
    $("#saveSheetInput").focus();
  });
  $("#saveSheetCancel").addEventListener("click", () => { $("#saveSheetBox").hidden = true; });
  $("#saveSheetConfirm").addEventListener("click", async () => {
    const name = $("#saveSheetInput").value.trim();
    if (!name) { toast("请填写清单名称", "err"); return; }
    try {
      await api("/api/sheets", { method: "POST", body: { name, items: tempItems.slice() } });
      $("#saveSheetBox").hidden = true;
      toast(`已保存到我的清单「${name}」`, "ok");
      await loadSheets();
    } catch (e) {
      toast(e.message, "err");
    }
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

  $("#allowRepeat").addEventListener("click", () => {
    picker.noRepeat = !picker.noRepeat;
    $("#allowRepeat").setAttribute("aria-checked", picker.noRepeat ? "false" : "true");
    $("#repeatLabel").textContent = picker.noRepeat ? "去重" : "可重复";
    clampQty();
  });
  $("#consumeSwitch").addEventListener("click", () => {
    picker.consume = !picker.consume;
    $("#consumeSwitch").setAttribute("aria-checked", picker.consume ? "true" : "false");
    $("#consumeLabel").textContent = picker.consume ? "消耗" : "保留";
  });

  $("#execBtn").addEventListener("click", executeDraw);
  $("#rerollBtn").addEventListener("click", executeDraw);
  $("#clearHistBtn").addEventListener("click", () => {
    history = [];
    persistPools();
    renderHistory();
    toast("已清空本次抽取记录（名单不受影响）");
  });

  /* —— 文章广场 —— */
  $("#plazaNewBtn").addEventListener("click", () => openEditor(null));
  $("#plazaFilterAll").addEventListener("click", () => {
    plaza.state.filter = "all";
    $("#plazaFilterAll").classList.add("active");
    $("#plazaFilterMine").classList.remove("active");
    renderPlazaList();
  });
  $("#plazaFilterMine").addEventListener("click", () => {
    plaza.state.filter = "mine";
    $("#plazaFilterMine").classList.add("active");
    $("#plazaFilterAll").classList.remove("active");
    renderPlazaList();
  });
  $("#readerBack").addEventListener("click", () => {
    plaza.state.view = "list";
    plaza.state.current = null;
    renderPlazaView();
  });
  $("#editorBack").addEventListener("click", () => {
    plaza.state.view = "list";
    renderPlazaView();
  });
  $("#editorCancel").addEventListener("click", () => {
    plaza.state.view = "list";
    renderPlazaView();
  });
  $("#editorPublic").addEventListener("click", () => setEditorPublic(true));
  $("#editorPrivate").addEventListener("click", () => setEditorPublic(false));
  $("#editorSave").addEventListener("click", saveArticle);
  $("#commentSend").addEventListener("click", sendComment);
  $("#commentInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendComment();
  });
  $("#editArticleBtn").addEventListener("click", () => {
    if (plaza.state.current) openEditor(plaza.state.current);
  });
  $("#deleteArticleBtn").addEventListener("click", (e) => {
    if (!plaza.state.current) return;
    armButton(e.currentTarget, "再点一次确认删除", async () => {
      try {
        await api("/api/articles/" + plaza.state.current.id, { method: "DELETE" });
        toast("文章已删除");
        await loadArticles();
        plaza.state.view = "list";
        plaza.state.current = null;
        renderPlazaView();
      } catch (err) {
        toast(err.message, "err");
      }
    });
  });

  /* —— 认证 —— */
  $("#authSwitch").addEventListener("click", () => setAuthMode(authMode === "login" ? "register" : "login"));
  $("#authSubmit").addEventListener("click", submitAuth);
  $("#authPass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAuth();
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
      stopwatch.id = setInterval(renderStopwatch, 100);
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
  initPrefs();
  renderUserUI();
  renderPreviewChips();
  renderFocus();
  renderDiceBoard();
  renderNotePreview();
  refreshStats();
  refreshPlazaCard();
  renderClock();
  setInterval(renderClock, 1000);
  setInterval(refreshStats, 30000);
  if (location.hostname.endsWith("github.io")) showStaticBanner();
  checkHealth();

  /* 启动时若有 token，校验一次会话 */
  if (auth.token) {
    api("/api/me").then((data) => {
      if (data && data.username) {
        auth.username = data.username;
        if (data.avatar !== undefined) auth.avatar = data.avatar || null;
        store.set("rhine.auth", { token: auth.token, username: auth.username, avatar: auth.avatar });
        renderUserUI();
        refreshPlazaCard();
      }
    }).catch(() => { /* 401 已在 api 内处理 */ });
  }

  /* URL 参数直达：?open=random|focus|dice|note|clock|plaza */
  const openParam = new URLSearchParams(location.search).get("open");
  if (openParam) openModal(openParam);
});
