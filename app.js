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
  avatar: savedAuth.avatar || null,
  isAdmin: false
};
let serverOnline = true;
let authReturnTo = null; // 登录成功后的返回目标（模块名）
let adminMode = false; // 管理员模式（仅管理员可切换）

function isAuthed() { return Boolean(auth.token); }

/* 头像渲染：色块 color:#rrggbb / 图片 data URL / 旧版 emoji */
function paintAvatar(el, name, avatar) {
  if (!el) return;
  el.textContent = "";
  el.style.backgroundImage = "";
  el.style.backgroundSize = "";
  el.style.backgroundPosition = "";
  el.style.background = "";
  el.classList.remove("has-image");
  const color = avatar && avatar.startsWith("color:") ? avatar.slice(6) : null;
  if (avatar && avatar.startsWith("data:image/")) {
    el.style.backgroundImage = `url("${avatar}")`;
    el.classList.add("has-image");
  } else if (color) {
    el.style.background = color;
    el.textContent = (name || "访").slice(0, 1).toUpperCase();
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

/* 壁纸：本地个性化，不改变毛玻璃模块 */
const WALLPAPER_KEY = "rhine.wallpaper";
const WALLPAPER_GRADS = {
  "grad-sunset": "linear-gradient(135deg, #ff9a56, #ff5e7e 60%, #b04bd9)",
  "grad-ocean": "linear-gradient(135deg, #36c2ff, #3b7cff 70%, #2b3aa8)",
  "grad-mint": "linear-gradient(135deg, #a8ffcb, #34d399 60%, #0ea5a5)",
  "grad-night": "linear-gradient(135deg, #2b2f5e, #1b1f3a 55%, #0d0f22)"
};
function applyWallpaper(value) {
  const body = document.body;
  if (!value || value === "none") {
    body.style.backgroundImage = "";
    body.classList.remove("has-wallpaper");
  } else {
    body.style.backgroundImage = WALLPAPER_GRADS[value] ? WALLPAPER_GRADS[value] : `url("${value}")`;
    body.classList.add("has-wallpaper");
  }
  $$("#wallpaperRow .wallpaper-swatch").forEach((s) => {
    s.classList.toggle("active", s.dataset.wall === (value || "none"));
  });
}
function initPrefs() {
  applyTheme(themeMode);
  applyAccent(store.get(ACCENT_KEY, "blue") || "blue");
  applyReader(store.get(READER_KEY, "serif") || "serif");
  applyMotion(store.get(MOTION_KEY, "normal") || "normal");
  applyWallpaper(store.get(WALLPAPER_KEY, "none") || "none");

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

function readWallpaperFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    toast("请选择图片文件", "err");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        toast("当前浏览器不支持图片处理", "err");
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      if (dataUrl.length > 400000) dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      store.set(WALLPAPER_KEY, dataUrl);
      applyWallpaper(dataUrl);
      toast("壁纸已更新", "ok");
    };
    img.onerror = () => toast("图片读取失败", "err");
    img.src = reader.result;
  };
  reader.onerror = () => toast("文件读取失败", "err");
  reader.readAsDataURL(file);
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
  /* 管理员入口 */
  const adminBtn = $("#adminBtn");
  const panelBtn = $("#adminPanelBtn");
  if (adminBtn) adminBtn.hidden = !(logged && auth.isAdmin);
  if (panelBtn) panelBtn.hidden = !(logged && auth.isAdmin && adminMode);
  if (adminBtn) adminBtn.classList.toggle("active", adminMode);
  /* 外卖数据删除：仅管理员可见 */
  const waimaiDel = $("#waimaiDeleteBtn");
  if (waimaiDel) waimaiDel.hidden = !(logged && auth.isAdmin);
}

/* 服务端刷新头像与管理员身份（登录后调用） */
async function refreshProfile() {
  if (!isAuthed()) return;
  try {
    const data = await api("/api/me");
    if (data) {
      auth.username = data.username || auth.username;
      if (data.avatar !== undefined) auth.avatar = data.avatar || null;
      auth.isAdmin = Boolean(data.isAdmin);
      store.set("rhine.auth", { token: auth.token, username: auth.username, avatar: auth.avatar });
      renderUserUI();
      paintAvatar($("#avatarPreview"), auth.username, auth.avatar);
    }
  } catch (e) { /* 忽略 */ }
}

/* ---------- 站点设置 / 版本 / 管理员 ---------- */
function escHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function renderMultiline(el, text) {
  if (!el) return;
  el.innerHTML = escHtml(text).replace(/\n/g, "<br />");
}

let siteSettings = null;

function applySiteSettings(s) {
  siteSettings = s;
  if (!s) return;
  document.title = s.siteName || document.title;
  const nameEl = $("#siteName");
  if (nameEl) nameEl.textContent = s.siteName || "RHEIN TERMINAL";
  renderMultiline($("#heroTitle"), s.heroTitle);
  renderMultiline($("#heroSub"), s.heroSub);
  const fn = $("#footerName");
  if (fn) fn.textContent = s.siteName || "RHEIN TERMINAL";
  const ft = $("#footerText");
  if (ft) ft.textContent = s.footerText || "";
  const ann = $("#announcement");
  if (ann) {
    if (s.announcement && s.announcement.trim()) {
      ann.textContent = s.announcement;
      ann.hidden = false;
    } else {
      ann.hidden = true;
    }
  }
}

/* 版本信息：只读，来自仓库 version.json；发版时更新该文件即可自动生效 */
let versionInfo = null;
async function loadVersionInfo() {
  try {
    const res = await fetch("version.json", { cache: "no-store" });
    if (res && res.ok) {
      const info = await res.json();
      if (info && info.version) versionInfo = info;
    }
  } catch (e) { /* 离线或静态环境忽略 */ }
  if (!versionInfo) versionInfo = { version: "0.0.0", build: "", changelog: [] };
  applyVersionBadge();
  return versionInfo;
}
function latestChange() {
  return (versionInfo && Array.isArray(versionInfo.changelog) && versionInfo.changelog[0]) || null;
}
function applyVersionBadge() {
  const badge = $("#versionBadge");
  if (!badge || !versionInfo) return;
  badge.textContent = "v" + versionInfo.version;
  const latest = latestChange();
  badge.title = latest ? `更新说明：${latest.title || ""}` : "点击查看更新信息";
}

async function loadSiteSettings() {
  try {
    const s = await api("/api/settings");
    applySiteSettings(s);
  } catch (e) { /* 离线时保留默认文案 */ }
  await loadVersionInfo();
  checkVersionNotice();
}

function checkVersionNotice() {
  if (!versionInfo) return;
  const seen = store.get("rhine.seenVersion", "");
  if (versionInfo.version && versionInfo.version !== seen) {
    store.set("rhine.seenVersion", versionInfo.version);
    const latest = latestChange();
    const msg = latest
      ? `已更新到 v${versionInfo.version}：${latest.title || ""}`
      : `已更新到 v${versionInfo.version}`;
    setTimeout(() => toast(msg, "ok"), 600);
  }
}

function toggleAdminMode() {
  if (!auth.isAdmin) return;
  adminMode = !adminMode;
  renderUserUI();
  toast(adminMode ? "管理员模式已开启" : "管理员模式已关闭", adminMode ? "ok" : "");
}

async function loadAdminConsole() {
  if (!auth.isAdmin) return;
  try {
    await loadVersionInfo();
    const [usersRes, settingsRes] = await Promise.all([
      api("/api/admin/users"),
      api("/api/admin/settings")
    ]);
    renderAdminUsers(usersRes.users || []);
    const st = settingsRes.settings || {};
    $("#setSiteName").value = st.siteName || "";
    $("#setHeroTitle").value = st.heroTitle || "";
    $("#setHeroSub").value = st.heroSub || "";
    $("#setFooterText").value = st.footerText || "";
    $("#setAnnouncement").value = st.announcement || "";
    renderAdminChangelog();
  } catch (e) {
    toast(e.message, "err");
  }
}

/* 只读更新日志：按版本倒序渲染 */
function renderAdminChangelog() {
  const now = $("#adminVersionNow");
  const build = $("#adminBuildDate");
  if (now) now.textContent = "v" + (versionInfo ? versionInfo.version : "—");
  if (build) build.textContent = versionInfo && versionInfo.build ? "构建于 " + versionInfo.build : "";
  const list = $("#adminChangelog");
  if (!list) return;
  list.innerHTML = "";
  const entries = (versionInfo && versionInfo.changelog) || [];
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "avatar-hint";
    empty.textContent = "暂无更新日志。";
    list.appendChild(empty);
    return;
  }
  entries.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "log-entry";
    const head = document.createElement("div");
    head.className = "log-head";
    const ver = document.createElement("span");
    ver.className = "log-ver mono";
    ver.textContent = "v" + entry.version;
    const title = document.createElement("span");
    title.className = "log-title";
    title.textContent = entry.title || "";
    const date = document.createElement("span");
    date.className = "log-date mono";
    date.textContent = entry.date || "";
    head.appendChild(ver);
    head.appendChild(title);
    head.appendChild(date);
    const ul = document.createElement("ul");
    ul.className = "log-items";
    (entry.items || []).forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      ul.appendChild(li);
    });
    item.appendChild(head);
    item.appendChild(ul);
    list.appendChild(item);
  });
}

function renderAdminUsers(users) {
  const list = $("#adminUserList");
  if (!list) return;
  list.innerHTML = "";
  users.forEach((u) => {
    const row = document.createElement("div");
    row.className = "admin-user";
    const av = document.createElement("span");
    av.className = "avatar avatar-clickable";
    paintAvatar(av, u.username, u.avatar);
    av.title = "查看并保存 " + u.username + " 的头像";
    av.addEventListener("click", (e) => {
      e.stopPropagation();
      openAvatarView(u.username, u.avatar);
    });
    const name = document.createElement("span");
    name.className = "admin-user-name";
    name.textContent = u.username;
    if (u.isAdmin) {
      const tag = document.createElement("span");
      tag.className = "admin-tag";
      tag.textContent = "管理员";
      name.appendChild(tag);
    }
    const meta = document.createElement("span");
    meta.className = "admin-user-meta";
    meta.textContent = u.createdAt ? new Date(u.createdAt).toLocaleDateString("zh-CN") : "";
    row.appendChild(av);
    row.appendChild(name);
    row.appendChild(meta);
    list.appendChild(row);
  });
}

async function saveAdminSettings(payload) {
  try {
    const res = await api("/api/admin/settings", { method: "PUT", body: payload });
    applySiteSettings({ ...(siteSettings || {}), ...res.settings });
    toast("已保存", "ok");
  } catch (e) {
    toast(e.message, "err");
  }
}

/* ---------- 自定义头像 ---------- */
const AVATAR_COLORS = ["#0071e3", "#34c759", "#ff9500", "#ff3b30", "#8b5cf6", "#d94f8a", "#00b8d9", "#5ac8fa"];

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
  AVATAR_COLORS.forEach((color) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "avatar-opt" + (auth.avatar === `color:${color}` ? " active" : "");
    b.style.background = color;
    b.setAttribute("aria-label", "颜色 " + color);
    b.addEventListener("click", () => saveAvatar(`color:${color}`));
    grid.appendChild(b);
  });
  paintAvatar($("#avatarPreview"), auth.username || "访", auth.avatar);
}

async function saveAvatar(value) {
  if (!isAuthed()) {
    toast("请先登录", "err");
    return false;
  }
  try {
    const data = await api("/api/me/avatar", { method: "PUT", body: { avatar: value } });
    auth.avatar = data.avatar || null;
    store.set("rhine.auth", { token: auth.token, username: auth.username, avatar: auth.avatar });
    renderUserUI();
    renderAvatarPicker();
    toast(value ? "头像已更新" : "已恢复默认头像", "ok");
    return true;
  } catch (e) {
    toast(e.message, "err");
    return false;
  }
}

/* ---------- 头像查看与保存 ---------- */
let avatarViewData = null;

function openAvatarView(name, avatar) {
  avatarViewData = { name: name || "用户", avatar: avatar || null };
  const el = $("#avatarViewImg");
  paintAvatar(el, avatarViewData.name, avatarViewData.avatar);
  const nameEl = $("#avatarViewName");
  if (nameEl) nameEl.textContent = avatarViewData.name;
  openModal("avatarView");
}

function buildAvatarCanvas(name, avatar) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(canvas);
  const color = avatar && avatar.startsWith("color:") ? avatar.slice(6) : "#a9a9af";
  const initial = (name || "访").slice(0, 1).toUpperCase();
  const drawFallback = () => {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 120px -apple-system, 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initial, size / 2, size / 2 + 6);
  };
  if (avatar && avatar.startsWith("data:image/")) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, 0, 0, size, size);
        ctx.restore();
        resolve(canvas);
      };
      img.onerror = () => {
        drawFallback();
        resolve(canvas);
      };
      img.src = avatar;
    });
  }
  drawFallback();
  return Promise.resolve(canvas);
}

async function saveAvatarImage() {
  if (!avatarViewData) return;
  const canvas = await buildAvatarCanvas(avatarViewData.name, avatarViewData.avatar);
  const link = document.createElement("a");
  link.download = "avatar-" + avatarViewData.name + ".png";
  link.href = canvas.toDataURL("image/png");
  link.click();
  toast("头像已保存", "ok");
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

/* 读取 JPEG EXIF Orientation（1–8，无则返回 1） */
function readJpegOrientation(arrayBuffer) {
  try {
    const view = new DataView(arrayBuffer);
    if (arrayBuffer.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1;
    let off = 2;
    while (off + 4 <= view.byteLength) {
      const marker = view.getUint16(off, false);
      if ((marker & 0xff00) !== 0xff00) break;
      const code = marker & 0xff;
      if (code === 0xd8) { off += 2; continue; }
      if (code === 0xd9 || code === 0xda) break;
      const len = view.getUint16(off + 2, false);
      if (code === 0xe1 && len >= 8 && view.getUint32(off + 4, false) === 0x45786966) {
        const tiff = off + 10;
        const little = view.getUint16(tiff, false) === 0x4949;
        const read16 = (p) => view.getUint16(p, little);
        const read32 = (p) => view.getUint32(p, little);
        if (read16(tiff) !== 0x2a) return 1;
        const ifd0 = tiff + read32(tiff + 4);
        const n = read16(ifd0);
        for (let i = 0; i < n; i++) {
          const e = ifd0 + 2 + i * 12;
          if (e + 12 > view.byteLength) break;
          if (read16(e) === 0x0112) return read16(e + 8) || 1;
        }
        return 1;
      }
      off += 2 + len;
    }
  } catch (e) { /* 忽略 */ }
  return 1;
}

/* 按 EXIF 方向把图片归一化（画到一张方向正确的 canvas 上） */
function normalizeImageOrientation(img, o) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const swap = o >= 5 && o <= 8;
  const cw = swap ? h : w;
  const ch = swap ? w : h;
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    switch (o) {
      case 2: ctx.translate(w, 0); ctx.scale(-1, 1); break;                 // 水平翻转
      case 3: ctx.translate(w, h); ctx.rotate(Math.PI); break;               // 180°
      case 4: ctx.translate(0, h); ctx.scale(1, -1); break;                  // 垂直翻转
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;                        // 转置
      case 6: ctx.translate(h, 0); ctx.rotate(Math.PI / 2); break;           // 顺时针 90°
      case 7: ctx.transform(0, -1, -1, 0, h - 1, w - 1); break;              // 反转置
      case 8: ctx.translate(0, w); ctx.rotate(-Math.PI / 2); break;          // 逆时针 90°
    }
    ctx.drawImage(img, 0, 0);
  }
  return canvas;
}

function loadImageForCrop(src, orientation) {
  const img = new Image();
  img.onload = () => {
    /* 始终归一化：方向摆正 + 画到 canvas，取景/预览/保存共用同一张图，杜绝不一致 */
    crop.img = normalizeImageOrientation(img, orientation);
    crop.W = crop.img.width;
    crop.H = crop.img.height;
    /* 先显示取景区域，再测量宽度（隐藏元素宽度为 0） */
    setCropMode(true);
    const viewport = $("#cropViewport");
    crop.view = (viewport && viewport.clientWidth) || 260;
    crop.scale0 = Math.max(crop.view / crop.W, crop.view / crop.H);
    crop.zoom = 1.2;
    crop.tx = (crop.view - crop.W * crop.scale0 * crop.zoom) / 2;
    crop.ty = (crop.view - crop.H * crop.scale0 * crop.zoom) / 2;
    const imgEl = $("#cropImage");
    imgEl.src = crop.img.toDataURL("image/jpeg", 0.95);
    $("#cropZoom").value = "1.2";
    layoutCrop();
  };
  img.onerror = () => toast("图片读取失败，请换一张试试", "err");
  img.src = src;
}

function openCropWithFile(file) {
  if (!file || !file.type.startsWith("image/")) {
    toast("请选择图片文件", "err");
    return;
  }
  if (crop.url) URL.revokeObjectURL(crop.url);
  crop.url = URL.createObjectURL(file);
  const reader = new FileReader();
  reader.onload = () => loadImageForCrop(crop.url, readJpegOrientation(reader.result));
  reader.onerror = () => loadImageForCrop(crop.url, 1);
  reader.readAsArrayBuffer(file);
}

function getCropRect() {
  const s = crop.scale0 * crop.zoom;
  const sw = crop.view / s;
  const sh = crop.view / s;
  const sx = Math.max(0, Math.min(crop.W - sw, -crop.tx / s));
  const sy = Math.max(0, Math.min(crop.H - sh, -crop.ty / s));
  return { sx, sy, sw, sh };
}

let previewRaf = 0;
function updatePreview() {
  if (!crop.img) return;
  const rect = getCropRect();
  const pv = 128;
  const c = document.createElement("canvas");
  c.width = pv;
  c.height = pv;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(crop.img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, pv, pv);
  const url = c.toDataURL("image/png");
  const preview = $("#avatarPreview");
  preview.style.backgroundImage = `url("${url}")`;
  preview.style.backgroundSize = "cover";
  preview.style.backgroundPosition = "center";
  preview.textContent = "";
  preview.classList.add("has-image");
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
  const zoomVal = $("#cropZoomVal");
  if (zoomVal) zoomVal.textContent = Math.round(crop.zoom * 100) + "%";
  /* 预览与最终保存共用同一条 canvas 管线，保证一致 */
  cancelAnimationFrame(previewRaf);
  previewRaf = requestAnimationFrame(updatePreview);
}

async function saveCroppedAvatar() {
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
  /* 与预览共用同一条取景计算，保证一致 */
  const rect = getCropRect();
  ctx.drawImage(crop.img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, size, size);
  let dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  if (dataUrl.length > 110000) dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  if (dataUrl.length > 110000) dataUrl = canvas.toDataURL("image/jpeg", 0.55);

  const btn = $("#cropSave");
  if (btn) btn.disabled = true;
  const ok = await saveAvatar(dataUrl);
  if (btn) btn.disabled = false;
  /* 成功时 saveAvatar 已重置裁剪视图；失败则保留裁剪界面方便重试 */
  if (!ok) toast("头像保存失败，请重试", "err");
}

function cancelCrop() {
  setCropMode(false);
  paintAvatar($("#avatarPreview"), auth.username || "访", auth.avatar);
}

async function checkHealth() {
  const chip = $("#serverChip");
  const label = $("#serverLabel");
  try {
    await api("/api/health");
    serverOnline = true;
    if (chip) {
      chip.dataset.state = "online";
      chip.title = "在线服务";
    }
    if (label) label.textContent = "在线";
  } catch (e) {
    serverOnline = false;
    if (chip) {
      chip.dataset.state = "offline";
      chip.title = "本地模式";
    }
    if (label) label.textContent = "本地";
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

/* —— 外卖商品名（由本机爬虫推送到站点） —— */
let waimaiItems = [];
let waimaiMeta = { source: "", updatedAt: 0 };

async function loadWaimai() {
  try {
    const data = await api("/api/waimai");
    waimaiItems = Array.isArray(data.items) ? data.items : [];
    waimaiMeta = { source: data.source || "", updatedAt: data.updatedAt || 0 };
  } catch (e) {
    waimaiItems = [];
    waimaiMeta = { source: "", updatedAt: 0 };
  }
  renderWaimaiPool();
  refreshPoolUI();
}

function renderWaimaiPool() {
  const wrap = $("#waimaiPool");
  if (!wrap) return;
  wrap.innerHTML = "";
  waimaiItems.forEach((name) => {
    const chip = document.createElement("span");
    chip.className = "item-chip on";
    chip.innerHTML = `<span class="tick">✓</span><span class="chip-name">${escapeHtml(name)}</span>`;
    wrap.appendChild(chip);
  });
  const count = $("#waimaiCount");
  if (count) count.textContent = waimaiItems.length + " 项";
  const status = $("#waimaiStatus");
  if (status) {
    status.textContent = waimaiItems.length
      ? `${waimaiMeta.source || "已同步"} · ${new Date(waimaiMeta.updatedAt).toLocaleString("zh-CN")}`
      : "暂无数据 · 运行爬虫并推送后点「同步」";
  }
}

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
  if (picker.tab === "waimai") {
    return waimaiItems.slice();
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
    const head = document.createElement("div");
    head.className = "c-head";
    const av = document.createElement("span");
    av.className = "avatar c-avatar";
    paintAvatar(av, c.username, c.avatar);
    av.title = "查看并保存 " + c.username + " 的头像";
    av.addEventListener("click", (e) => {
      e.stopPropagation();
      openAvatarView(c.username, c.avatar);
    });
    const name = document.createElement("span");
    name.className = "c-name";
    name.textContent = c.username;
    const time = document.createElement("span");
    time.textContent = timeAgo(c.createdAt);
    head.appendChild(av);
    head.appendChild(name);
    head.appendChild(time);
    if (c.mine) {
      const del = document.createElement("button");
      del.className = "c-del";
      del.dataset.id = c.id;
      del.textContent = "删除";
      head.appendChild(del);
    }
    const body = document.createElement("div");
    body.className = "c-content";
    body.textContent = c.content;
    li.appendChild(head);
    li.appendChild(body);
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
   M-03 小游戏合集：掷骰子 / 猜数字 / 记忆翻牌 / 井字棋
   ============================================================ */
const gameState = { active: "dice" };

function setGame(name) {
  gameState.active = name;
  $$("#gameTabs .game-tab").forEach((t) => t.classList.toggle("active", t.dataset.game === name));
  $$("#modalDice .game-pane").forEach((p) => {
    p.hidden = p.dataset.gamepane !== name;
  });
  if (name === "guess") ensureGuess();
  if (name === "memory") ensureMemory();
  if (name === "ttt") ensureTtt();
  if (name === "g2048") ensureG2048();
  if (name === "chess") ensureChess();
  if (name === "dice") renderDiceBoard();
  const input = $("#guessInput");
  if (name === "guess" && input && !input.disabled && document.activeElement !== input) {
    try { input.focus(); } catch (e) { /* 忽略 */ }
  }
}

/* —— 猜数字 —— */
const guessGame = { target: 0, tries: 0, over: false, started: false };
function ensureGuess() {
  if (!guessGame.started) startGuess();
}
function startGuess() {
  guessGame.target = 1 + Math.floor(Math.random() * 100);
  guessGame.tries = 0;
  guessGame.over = false;
  guessGame.started = true;
  const input = $("#guessInput");
  input.value = "";
  input.disabled = false;
  $("#guessSubmit").disabled = false;
  $("#guessStatus").textContent = "范围 1–100 · 已猜 0 次";
  $("#guessHistory").innerHTML = "";
}
function submitGuess() {
  if (guessGame.over) return;
  const input = $("#guessInput");
  const n = parseInt(input.value, 10);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    toast("请输入 1–100 的整数", "err");
    return;
  }
  guessGame.tries += 1;
  const li = document.createElement("li");
  let msg;
  if (n === guessGame.target) {
    msg = "猜中！";
    guessGame.over = true;
  } else if (n < guessGame.target) {
    msg = "太小了 ↑";
  } else {
    msg = "太大了 ↓";
  }
  li.textContent = `${n} · ${msg}`;
  const badge = document.createElement("span");
  badge.textContent = "#" + guessGame.tries;
  li.appendChild(badge);
  $("#guessHistory").appendChild(li);
  if (guessGame.over) {
    $("#guessStatus").textContent = `猜中！共用 ${guessGame.tries} 次`;
    input.disabled = true;
    $("#guessSubmit").disabled = true;
    toast(`猜中 ${guessGame.target}，用了 ${guessGame.tries} 次`, "ok");
  } else {
    $("#guessStatus").textContent = `已猜 ${guessGame.tries} 次 · ${n < guessGame.target ? "答案更大" : "答案更小"}`;
  }
  input.value = "";
}

/* —— 记忆翻牌 —— */
const MEMORY_SYMBOLS = ["🍎", "🍊", "🍋", "🍇", "🍓", "🍑", "🍒", "🍉"];
const memoryGame = { deck: [], flipped: [], matched: new Set(), moves: 0, lock: false, started: false };
function ensureMemory() {
  if (!memoryGame.started) startMemory();
}
function startMemory() {
  const deck = [];
  MEMORY_SYMBOLS.forEach((sym) => {
    deck.push({ sym });
    deck.push({ sym });
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
  memoryGame.deck = deck;
  memoryGame.flipped = [];
  memoryGame.matched = new Set();
  memoryGame.moves = 0;
  memoryGame.lock = false;
  memoryGame.started = true;
  renderMemory();
}
function renderMemory() {
  const grid = $("#memoryGrid");
  if (!grid) return;
  grid.innerHTML = "";
  memoryGame.deck.forEach((card, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "memory-card";
    if (memoryGame.matched.has(idx)) {
      btn.classList.add("matched");
      btn.textContent = card.sym;
    } else if (memoryGame.flipped.includes(idx)) {
      btn.classList.add("flipped");
      btn.textContent = card.sym;
    }
    btn.addEventListener("click", () => flipMemory(idx));
    grid.appendChild(btn);
  });
  const status = $("#memoryStatus");
  if (status) status.textContent = `步数 ${memoryGame.moves} · 配对 ${memoryGame.matched.size / 2}/${MEMORY_SYMBOLS.length}`;
}
function flipMemory(idx) {
  const g = memoryGame;
  if (g.lock || g.matched.has(idx) || g.flipped.includes(idx)) return;
  g.flipped.push(idx);
  renderMemory();
  if (g.flipped.length === 2) {
    g.moves += 1;
    const a = g.flipped[0];
    const b = g.flipped[1];
    if (g.deck[a].sym === g.deck[b].sym) {
      g.matched.add(a);
      g.matched.add(b);
      g.flipped = [];
      renderMemory();
      if (g.matched.size === g.deck.length) {
        $("#memoryStatus").textContent = `全部配对！共用 ${g.moves} 步`;
        toast("记忆翻牌完成 🎉", "ok");
      }
    } else {
      g.lock = true;
      setTimeout(() => {
        g.flipped = [];
        g.lock = false;
        renderMemory();
      }, 760);
    }
  }
}

/* —— 井字棋 —— */
const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const tttGame = { board: [], over: false, busy: false, started: false };
function ensureTtt() {
  if (!tttGame.started) startTtt();
}
function startTtt() {
  tttGame.board = Array(9).fill("");
  tttGame.over = false;
  tttGame.busy = false;
  tttGame.started = true;
  renderTtt();
  $("#tttStatus").textContent = "轮到你走（X）";
}
function tttWinner(board) {
  for (const line of TTT_LINES) {
    const a = line[0];
    const b = line[1];
    const c = line[2];
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { mark: board[a], line };
    }
  }
  return null;
}
function renderTtt(win) {
  const grid = $("#tttGrid");
  if (!grid) return;
  grid.innerHTML = "";
  tttGame.board.forEach((mark, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ttt-cell" + (mark ? " " + mark.toLowerCase() : "");
    if (win && win.line.includes(i)) btn.classList.add("win");
    btn.textContent = mark;
    btn.disabled = tttGame.over || tttGame.busy || Boolean(mark);
    btn.addEventListener("click", () => tttClick(i));
    grid.appendChild(btn);
  });
}
function tttClick(i) {
  const g = tttGame;
  if (g.over || g.busy || g.board[i]) return;
  g.board[i] = "X";
  const win = tttWinner(g.board);
  if (win) {
    g.over = true;
    renderTtt(win);
    $("#tttStatus").textContent = "你赢了 🎉";
    toast("你赢了！", "ok");
    return;
  }
  if (g.board.every((v) => v)) {
    g.over = true;
    renderTtt();
    $("#tttStatus").textContent = "平局";
    return;
  }
  g.busy = true;
  renderTtt();
  $("#tttStatus").textContent = "电脑思考中…";
  setTimeout(() => {
    const move = bestTttMove(g.board);
    g.board[move] = "O";
    const w2 = tttWinner(g.board);
    g.busy = false;
    if (w2) {
      g.over = true;
      renderTtt(w2);
      $("#tttStatus").textContent = "电脑赢了，再来一局？";
    } else if (g.board.every((v) => v)) {
      g.over = true;
      renderTtt();
      $("#tttStatus").textContent = "平局";
    } else {
      renderTtt();
      $("#tttStatus").textContent = "轮到你走（X）";
    }
  }, 280);
}
function findWinningMove(board, mark) {
  for (const line of TTT_LINES) {
    const marks = line.map((i) => board[i]);
    if (marks.filter((m) => m === mark).length === 2 && marks.includes("")) {
      return line[marks.indexOf("")];
    }
  }
  return -1;
}
function bestTttMove(board) {
  let m = findWinningMove(board, "O");
  if (m >= 0) return m;
  m = findWinningMove(board, "X");
  if (m >= 0) return m;
  if (!board[4]) return 4;
  const corners = [0, 2, 6, 8].filter((i) => !board[i]);
  if (corners.length) return corners[Math.floor(Math.random() * corners.length)];
  const free = board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  return free[Math.floor(Math.random() * free.length)];
}

/* —— 2048 —— */
const g2048 = { grid: [], score: 0, best: store.get("rhine.2048best", 0) || 0, over: false, started: false };
function ensureG2048() {
  if (!g2048.started) start2048();
}
function start2048() {
  g2048.grid = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  g2048.score = 0;
  g2048.over = false;
  g2048.started = true;
  spawn2048();
  spawn2048();
  render2048();
}
function spawn2048() {
  const empty = [];
  g2048.grid.forEach((row, r) => row.forEach((v, c) => { if (!v) empty.push([r, c]); }));
  if (!empty.length) return;
  const pair = empty[Math.floor(Math.random() * empty.length)];
  g2048.grid[pair[0]][pair[1]] = Math.random() < 0.9 ? 2 : 4;
}
function mergeLine2048(arr) {
  const nums = arr.filter((v) => v);
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] === nums[i + 1]) {
      out.push(nums[i] * 2);
      g2048.score += nums[i] * 2;
      i++;
    } else {
      out.push(nums[i]);
    }
  }
  while (out.length < 4) out.push(0);
  return out;
}
function move2048(dir) {
  if (g2048.over || !g2048.started) return;
  const before = JSON.stringify(g2048.grid);
  for (let i = 0; i < 4; i++) {
    let line;
    if (dir === "left" || dir === "right") {
      line = g2048.grid[i].slice();
      if (dir === "right") line.reverse();
      line = mergeLine2048(line);
      if (dir === "right") line.reverse();
      g2048.grid[i] = line;
    } else {
      line = [0, 1, 2, 3].map((r) => g2048.grid[r][i]);
      if (dir === "down") line.reverse();
      line = mergeLine2048(line);
      if (dir === "down") line.reverse();
      for (let r = 0; r < 4; r++) g2048.grid[r][i] = line[r];
    }
  }
  if (JSON.stringify(g2048.grid) === before) return;
  spawn2048();
  if (g2048.score > g2048.best) {
    g2048.best = g2048.score;
    store.set("rhine.2048best", g2048.best);
  }
  if (is2048Over()) g2048.over = true;
  render2048();
}
function is2048Over() {
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (!g2048.grid[r][c]) return false;
      if (c < 3 && g2048.grid[r][c] === g2048.grid[r][c + 1]) return false;
      if (r < 3 && g2048.grid[r][c] === g2048.grid[r + 1][c]) return false;
    }
  }
  return true;
}
function render2048() {
  const grid = $("#g2048Grid");
  if (!grid) return;
  grid.innerHTML = "";
  g2048.grid.flat().forEach((v) => {
    const cell = document.createElement("div");
    cell.className = "g2048-cell" + (v ? " v" + Math.min(v, 2048) : "");
    cell.textContent = v || "";
    grid.appendChild(cell);
  });
  $("#g2048Score").textContent = "分数 " + g2048.score;
  $("#g2048Best").textContent = "最高 " + g2048.best;
  $("#g2048Status").textContent = g2048.over ? "没有可移动的方向了，点重新开始" : "方向键 / 按钮移动";
}

/* —— 国际象棋（测试版，双人对弈） —— */
const CHESS_GLYPH = {
  wK: "♔", wQ: "♕", wR: "♖", wB: "♗", wN: "♘", wP: "♙",
  bK: "♚", bQ: "♛", bR: "♜", bB: "♝", bN: "♞", bP: "♟"
};
const chess = { board: [], turn: "w", sel: -1, moves: [], over: false, started: false };
function ensureChess() {
  if (!chess.started) startChess();
}
function startChess() {
  const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  const board = [];
  back.forEach((t) => board.push("b" + t));
  for (let i = 0; i < 8; i++) board.push("bP");
  for (let i = 0; i < 32; i++) board.push(null);
  for (let i = 0; i < 8; i++) board.push("wP");
  back.forEach((t) => board.push("w" + t));
  chess.board = board;
  chess.turn = "w";
  chess.sel = -1;
  chess.moves = [];
  chess.over = false;
  chess.started = true;
  renderChess();
  setChessStatus("白方走棋");
}
function setChessStatus(text) {
  const status = $("#chessStatus");
  if (status) status.textContent = text;
  const turn = $("#chessTurn");
  if (turn) turn.textContent = text;
}
function renderChess() {
  const grid = $("#chessGrid");
  if (!grid) return;
  grid.innerHTML = "";
  chess.board.forEach((piece, i) => {
    const r = Math.floor(i / 8);
    const c = i % 8;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chess-cell " + ((r + c) % 2 === 0 ? "light" : "dark");
    if (i === chess.sel) btn.classList.add("sel");
    if (chess.moves.includes(i)) btn.classList.add("move");
    if (piece && piece[0] === "w") btn.classList.add("white-piece");
    if (piece && piece[0] === "b") btn.classList.add("black-piece");
    if (piece) btn.textContent = CHESS_GLYPH[piece];
    btn.addEventListener("click", () => chessClick(i));
    grid.appendChild(btn);
  });
}
function chessMovesFrom(from, piece) {
  const color = piece[0];
  const type = piece[1];
  const r = Math.floor(from / 8);
  const c = from % 8;
  const out = [];
  const at = (rr, cc) => (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) ? chess.board[rr * 8 + cc] : undefined;
  const add = (rr, cc) => {
    if (rr < 0 || rr > 7 || cc < 0 || cc > 7) return false;
    const target = at(rr, cc);
    if (!target) {
      out.push(rr * 8 + cc);
      return true;
    }
    if (target[0] !== color) out.push(rr * 8 + cc);
    return false;
  };
  const slide = (dirs) => dirs.forEach(([dr, dc]) => {
    let rr = r + dr;
    let cc = c + dc;
    while (add(rr, cc)) {
      rr += dr;
      cc += dc;
    }
  });
  if (type === "P") {
    const dir = color === "w" ? -1 : 1;
    const startRow = color === "w" ? 6 : 1;
    const one = r + dir;
    if (one >= 0 && one <= 7 && !at(one, c)) {
      out.push(one * 8 + c);
      const two = r + 2 * dir;
      if (r === startRow && two >= 0 && two <= 7 && !at(two, c)) out.push(two * 8 + c);
    }
    [[dir, -1], [dir, 1]].forEach(([dr, dc]) => {
      const t = at(r + dr, c + dc);
      if (t && t[0] !== color) out.push((r + dr) * 8 + (c + dc));
    });
  } else if (type === "N") {
    [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach(([dr, dc]) => add(r + dr, c + dc));
  } else if (type === "B") {
    slide([[-1, -1], [-1, 1], [1, -1], [1, 1]]);
  } else if (type === "R") {
    slide([[-1, 0], [1, 0], [0, -1], [0, 1]]);
  } else if (type === "Q") {
    slide([[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]);
  } else if (type === "K") {
    [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]].forEach(([dr, dc]) => add(r + dr, c + dc));
  }
  return out;
}
function chessClick(i) {
  if (chess.over) return;
  if (chess.sel >= 0 && chess.moves.includes(i)) {
    const moving = chess.board[chess.sel];
    chess.board[i] = moving;
    chess.board[chess.sel] = null;
    if (moving === "wP" && Math.floor(i / 8) === 0) chess.board[i] = "wQ";
    if (moving === "bP" && Math.floor(i / 8) === 7) chess.board[i] = "bQ";
    chess.sel = -1;
    chess.moves = [];
    chess.turn = chess.turn === "w" ? "b" : "w";
    renderChess();
    if (!chess.board.includes("bK")) {
      chess.over = true;
      setChessStatus("白方获胜");
      toast("白方获胜", "ok");
    } else if (!chess.board.includes("wK")) {
      chess.over = true;
      setChessStatus("黑方获胜");
      toast("黑方获胜", "ok");
    } else {
      setChessStatus(chess.turn === "w" ? "白方走棋" : "黑方走棋");
    }
    return;
  }
  const piece = chess.board[i];
  if (piece && piece[0] === chess.turn) {
    chess.sel = i;
    chess.moves = chessMovesFrom(i, piece);
    renderChess();
  } else {
    chess.sel = -1;
    chess.moves = [];
    renderChess();
  }
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
  avatarView: "modalAvatarView",
  settings: "modalSettings",
  admin: "modalAdmin"
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
  if (name === "dice") {
    renderDiceBoard();
    setGame(gameState.active || "dice");
  }
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
    applyWallpaper(store.get(WALLPAPER_KEY, "none") || "none");
  }
  if (name === "admin") loadAdminConsole();
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

/* ============================================================
   模块布局：大小（方形 / 长方形）· 位置 · 隐藏
   ============================================================ */
const LAYOUT_KEY = "rhine.layout";
let layoutEditing = false;
let moduleLayout = [];

const CTRL_ICONS = {
  size: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/></svg>',
  hide: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 9 7 0 .9-.5 2-1.4 3.1M6.6 6.6C4 8.2 3 10.3 3 12c0 2.5 4 7 9 7 1 0 1.9-.2 2.7-.5"/></svg>',
  left: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'
};

function getModuleCards() {
  return $$("#modules [data-module]");
}
function defaultModuleLayout() {
  return getModuleCards().map((card) => ({
    id: card.dataset.module,
    shape: card.classList.contains("feature") ? "wide" : "square",
    hidden: false
  }));
}
function loadModuleLayout() {
  const defs = defaultModuleLayout();
  const saved = store.get(LAYOUT_KEY, null);
  if (!Array.isArray(saved)) return defs;
  const out = [];
  saved.forEach((x) => {
    if (x && x.id && defs.some((d) => d.id === x.id) && !out.some((y) => y.id === x.id)) {
      out.push({
        id: x.id,
        shape: x.shape === "wide" ? "wide" : "square",
        hidden: Boolean(x.hidden)
      });
    }
  });
  defs.forEach((d) => {
    if (!out.some((x) => x.id === d.id)) out.push(d);
  });
  return out;
}
function saveModuleLayout() {
  store.set(LAYOUT_KEY, moduleLayout);
}
function applyModuleLayout() {
  const grid = $("#modules .grid");
  if (!grid) return;
  const cards = getModuleCards();
  moduleLayout.forEach((entry) => {
    const card = cards.find((c) => c.dataset.module === entry.id);
    if (!card) return;
    card.classList.toggle("shape-wide", entry.shape === "wide");
    card.classList.toggle("shape-square", entry.shape !== "wide");
    card.classList.toggle("is-hidden-card", entry.hidden);
    card.hidden = entry.hidden && !layoutEditing;
    grid.appendChild(card);
  });
}
function setLayoutEditing(on) {
  layoutEditing = on;
  const grid = $("#modules .grid");
  const btn = $("#layoutToggle");
  const hint = $("#layoutHint");
  if (grid) grid.classList.toggle("editing", on);
  if (btn) {
    btn.textContent = on ? "完成调整" : "调整布局";
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  if (hint) hint.hidden = !on;
  getModuleCards().forEach((card) => {
    card.draggable = on;
    card.classList.toggle("is-editing", on);
    let ctrl = card.querySelector(".card-ctrl");
    if (on && !ctrl) {
      ctrl = document.createElement("div");
      ctrl.className = "card-ctrl";
      ctrl.innerHTML =
        '<button type="button" data-act="size" title="切换方形 / 长方形" aria-label="切换形状">' + CTRL_ICONS.size + "</button>" +
        '<button type="button" data-act="hide" title="隐藏 / 显示" aria-label="隐藏模块">' + CTRL_ICONS.hide + "</button>" +
        '<button type="button" data-act="left" title="向左移动" aria-label="向左移动">' + CTRL_ICONS.left + "</button>" +
        '<button type="button" data-act="right" title="向右移动" aria-label="向右移动">' + CTRL_ICONS.right + "</button>";
      card.appendChild(ctrl);
    }
    if (!on && ctrl) ctrl.remove();
  });
  applyModuleLayout();
}
function moveModule(id, dir) {
  const i = moduleLayout.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= moduleLayout.length) return;
  const [entry] = moduleLayout.splice(i, 1);
  moduleLayout.splice(j, 0, entry);
  applyModuleLayout();
  saveModuleLayout();
}
function moveModuleBefore(id, targetId) {
  const i = moduleLayout.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [entry] = moduleLayout.splice(i, 1);
  let t = moduleLayout.findIndex((x) => x.id === targetId);
  if (t < 0) t = moduleLayout.length;
  moduleLayout.splice(t, 0, entry);
  applyModuleLayout();
  saveModuleLayout();
}
function initModuleLayout() {
  moduleLayout = loadModuleLayout();
  applyModuleLayout();
  const toggle = $("#layoutToggle");
  if (toggle) toggle.addEventListener("click", () => setLayoutEditing(!layoutEditing));

  const grid = $("#modules .grid");
  if (!grid) return;
  grid.addEventListener("click", (e) => {
    if (!layoutEditing) return;
    const ctrlBtn = e.target.closest("[data-act]");
    if (!ctrlBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const card = ctrlBtn.closest("[data-module]");
    const id = card && card.dataset.module;
    const entry = moduleLayout.find((x) => x.id === id);
    if (!entry) return;
    const act = ctrlBtn.dataset.act;
    if (act === "size") {
      entry.shape = entry.shape === "wide" ? "square" : "wide";
      applyModuleLayout();
      saveModuleLayout();
    } else if (act === "hide") {
      entry.hidden = !entry.hidden;
      applyModuleLayout();
      saveModuleLayout();
    } else if (act === "left") {
      moveModule(id, -1);
    } else if (act === "right") {
      moveModule(id, 1);
    }
  });

  /* 拖拽排序（桌面）；移动端用左右箭头 */
  let dragId = null;
  getModuleCards().forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      if (!layoutEditing) {
        e.preventDefault();
        return;
      }
      dragId = card.dataset.module;
      card.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", dragId); } catch (err) { /* 忽略 */ }
      }
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      dragId = null;
      getModuleCards().forEach((c) => c.classList.remove("drop-target"));
    });
    card.addEventListener("dragover", (e) => {
      if (!layoutEditing || !dragId || dragId === card.dataset.module) return;
      e.preventDefault();
      card.classList.add("drop-target");
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
    card.addEventListener("drop", (e) => {
      if (!layoutEditing || !dragId || dragId === card.dataset.module) return;
      e.preventDefault();
      card.classList.remove("drop-target");
      moveModuleBefore(dragId, card.dataset.module);
    });
  });
}

/* ---------- 事件绑定 ---------- */
document.addEventListener("DOMContentLoaded", () => {
  initModuleLayout();
  /* 模块卡片与通用按钮 */
  $$("[data-module]").forEach((card) => {
    const name = card.dataset.module;
    const open = () => {
      if (layoutEditing) return;
      openModal(name);
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
  $$("[data-open]").forEach((b) =>
    b.addEventListener("click", () => {
      if (layoutEditing) return;
      openModal(b.dataset.open);
    })
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
  $("#avatarSaveBtn").addEventListener("click", saveAvatarImage);
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

  /* 壁纸 */
  $("#wallpaperRow").addEventListener("click", (e) => {
    const sw = e.target.closest("[data-wall]");
    if (!sw) return;
    store.set(WALLPAPER_KEY, sw.dataset.wall);
    applyWallpaper(sw.dataset.wall);
  });
  $("#wallpaperFile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) readWallpaperFile(file);
    e.target.value = "";
  });

  /* 管理员 */
  $("#adminBtn").addEventListener("click", toggleAdminMode);
  $("#adminPanelBtn").addEventListener("click", () => openModal("admin"));
  $$("#modalAdmin [data-admintab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.admintab;
      $$("#modalAdmin [data-admintab]").forEach((t) => t.classList.toggle("active", t === tab));
      $$("#modalAdmin [data-adminpane]").forEach((p) => {
        p.hidden = p.dataset.adminpane !== key;
      });
    });
  });
  $("#saveTextSettings").addEventListener("click", () => {
    saveAdminSettings({
      siteName: $("#setSiteName").value,
      heroTitle: $("#setHeroTitle").value,
      heroSub: $("#setHeroSub").value,
      footerText: $("#setFooterText").value,
      announcement: $("#setAnnouncement").value
    });
  });
  $("#versionBadge").addEventListener("click", () => {
    const latest = latestChange();
    if (latest) toast(`v${versionInfo.version} · ${latest.title || ""}`, "");
    else openSettings();
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
      if (picker.tab === "waimai") loadWaimai();
      refreshPoolUI();
    })
  );
  $("#waimaiRefresh").addEventListener("click", () => loadWaimai());

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

  /* 外卖商品：存为清单 / 删除数据 */
  $("#waimaiSaveBtn").addEventListener("click", () => {
    if (!isAuthed()) { openAuthFrom("random"); return; }
    if (!waimaiItems.length) { toast("外卖商品为空，先点「同步」", "err"); return; }
    $("#waimaiSheetName").value = "外卖候选";
    $("#waimaiSaveBox").hidden = false;
    $("#waimaiSheetName").focus();
  });
  $("#waimaiSaveCancel").addEventListener("click", () => { $("#waimaiSaveBox").hidden = true; });
  $("#waimaiSaveConfirm").addEventListener("click", async () => {
    const name = $("#waimaiSheetName").value.trim();
    if (!name) { toast("请填写清单名称", "err"); return; }
    try {
      await api("/api/sheets", { method: "POST", body: { name, items: waimaiItems.slice() } });
      $("#waimaiSaveBox").hidden = true;
      toast(`已生成云端清单「${name}」`, "ok");
      await loadSheets();
      const sheetsTab = document.querySelector('.tab[data-tab="sheets"]');
      if (sheetsTab) sheetsTab.click();
    } catch (e) {
      toast(e.message, "err");
    }
  });
  $("#waimaiDeleteBtn").addEventListener("click", (e) => {
    if (!isAuthed() || !auth.isAdmin) { toast("需要管理员权限", "err"); return; }
    armButton(e.currentTarget, "再点一次确认删除", async () => {
      try {
        await api("/api/waimai", { method: "DELETE" });
        waimaiItems = [];
        waimaiMeta = { source: "", updatedAt: 0 };
        renderWaimaiPool();
        refreshPoolUI();
        toast("已删除爬取的外卖数据", "ok");
      } catch (err) {
        toast(err.message, "err");
      }
    });
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

  /* —— 小游戏合集 —— */
  $$("#gameTabs .game-tab").forEach((tab) =>
    tab.addEventListener("click", () => setGame(tab.dataset.game))
  );
  $("#guessSubmit").addEventListener("click", submitGuess);
  $("#guessInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitGuess();
    }
  });
  $("#guessReset").addEventListener("click", startGuess);
  $("#memoryReset").addEventListener("click", startMemory);
  $("#tttReset").addEventListener("click", startTtt);
  $$("#modalDice [data-g2048]").forEach((b) =>
    b.addEventListener("click", () => move2048(b.dataset.g2048))
  );
  $("#g2048Reset").addEventListener("click", start2048);
  $("#chessReset").addEventListener("click", startChess);
  document.addEventListener("keydown", (e) => {
    if (!currentModal || currentModal.id !== "modalDice") return;
    if (gameState.active !== "g2048") return;
    const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    move2048(dir);
  });

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
  loadSiteSettings();

  /* 启动时若有 token，校验一次会话 */
  if (auth.token) {
    api("/api/me").then((data) => {
      if (data && data.username) {
        auth.username = data.username;
        if (data.avatar !== undefined) auth.avatar = data.avatar || null;
        auth.isAdmin = Boolean(data.isAdmin);
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
