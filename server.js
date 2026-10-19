/* ============================================================
   RHEIN TERMINAL · server.js
   零依赖 Node 后端：静态托管 + 账号 + 云端清单 + 文章广场
   运行：node server.js  （端口可用 PORT 环境变量覆盖）
   数据：data/db.json  （可用 RHINE_DATA 环境变量指定目录）
   ============================================================ */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = __dirname;

/* 读取本地 .env / .env.local（Neon 的 neon deploy / neon env pull 会写入这些文件）。
   已存在的进程环境变量优先，不会覆盖平台注入的值。
   设置 RHINE_NO_ENV_FILE=1 可跳过（测试使用隔离环境时）。 */
function loadEnvFiles() {
  if (process.env.RHINE_NO_ENV_FILE === "1") return;
  for (const name of [".env", ".env.local"]) {
    try {
      const text = fs.readFileSync(path.join(ROOT, name), "utf8");
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
      }
    } catch (e) { /* 文件不存在时忽略 */ }
  }
}
loadEnvFiles();

const DATA_DIR = process.env.RHINE_DATA || path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const PORT = Number(process.env.PORT || 8000);
const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 天
const ONLINE_WINDOW = 5 * 60 * 1000; // 5 分钟内视为在线

/* ---------- 版本信息（只读，来自仓库 version.json） ---------- */
function loadVersionInfo() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, "version.json"), "utf8");
    const info = JSON.parse(raw);
    return {
      version: String(info.version || "0.0.0"),
      build: String(info.build || ""),
      changelog: Array.isArray(info.changelog) ? info.changelog : []
    };
  } catch (e) {
    return { version: "0.0.0", build: "", changelog: [] };
  }
}
const VERSION_INFO = loadVersionInfo();

/* ---------- 数据层 ---------- */
const DATABASE_URL = process.env.DATABASE_URL || "";
const STORE_ID = "rhein-terminal";
let pgPool = null;
let writeChain = Promise.resolve();

const DEFAULT_SETTINGS = {
  siteName: "RHEIN TERMINAL · 模块工具台",
  heroTitle: "让每一次随机，\n都有迹可循。",
  heroSub: "简洁的模块化工具台。清单随账号同步，文章随心情公开。\n一切都安静地发生，像苹果那样。",
  footerText: "清单与文章随账号存储 · 未登录时文章全部私密",
  announcement: "",
  version: "2.3.0",
  updates: "修复已知问题，新增管理员模式、个性化壁纸、界面文字编辑。"
};

const emptyDb = () => ({ users: [], sheets: [], articles: [], sessions: [], invites: [], comments: [], settings: { ...DEFAULT_SETTINGS }, waimai: { source: "", updatedAt: 0, items: [] } });

function normalizeWaimaiItem(x) {
  if (typeof x === "string") {
    const name = x.replace(/\s+/g, " ").trim().slice(0, 60);
    return name ? { name, price: null, shop: "" } : null;
  }
  if (!x || typeof x !== "object") return null;
  const name = String(x.name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) return null;
  const n = Number(x.price);
  const price = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
  return { name, price, shop: String(x.shop || "").slice(0, 40) };
}

function normalizeDb(raw) {
  return {
    users: Array.isArray(raw.users) ? raw.users : [],
    sheets: Array.isArray(raw.sheets) ? raw.sheets : [],
    articles: Array.isArray(raw.articles) ? raw.articles : [],
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    invites: Array.isArray(raw.invites) ? raw.invites : [],
    comments: Array.isArray(raw.comments) ? raw.comments : [],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
    waimai: {
      source: String((raw.waimai && raw.waimai.source) || ""),
      updatedAt: Number((raw.waimai && raw.waimai.updatedAt) || 0),
      items: (Array.isArray(raw.waimai && raw.waimai.items) ? raw.waimai.items : [])
        .map(normalizeWaimaiItem)
        .filter(Boolean)
    }
  };
}

let db = emptyDb();

/* 本地模式：从 data/db.json 读；云端模式（DATABASE_URL）：从 Postgres 读 */
async function initStore() {
  if (!DATABASE_URL) {
    loadDb();
    return;
  }
  const { Pool } = require("pg");
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
    max: 3
  });
  await pgPool.query(`create table if not exists app_state (
    id text primary key,
    data jsonb not null,
    updated_at timestamptz not null default now()
  )`);
  const r = await pgPool.query("select data from app_state where id = $1", [STORE_ID]);
  if (r.rows.length) {
    db = normalizeDb(r.rows[0].data);
  } else {
    db = emptyDb();
    await saveDb();
  }
  console.log("云端数据库已连接（PostgreSQL）");
}

function loadDb() {
  try {
    db = normalizeDb(JSON.parse(fs.readFileSync(DB_PATH, "utf8")));
  } catch {
    db = emptyDb();
  }
}

function saveDb() {
  if (pgPool) {
    /* 串行写入快照，避免并发请求互相覆盖 */
    const snapshot = JSON.stringify(db);
    writeChain = writeChain
      .then(() =>
        pgPool.query(
          `insert into app_state (id, data, updated_at) values ($1, $2::jsonb, now())
           on conflict (id) do update set data = excluded.data, updated_at = now()`,
          [STORE_ID, snapshot]
        )
      )
      .catch((e) => console.error("[db] 云端保存失败:", e.message));
    return writeChain;
  }
  /* 本地模式：保存前先从磁盘同步邀请码（多进程共用数据文件时防丢码） */
  syncInvitesFromDisk();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_PATH);
  return Promise.resolve();
}

/* 把磁盘上新增/已使用的邀请码合并进内存（多进程共用同一数据文件的场景） */
function syncInvitesFromDisk() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    const disk = Array.isArray(raw.invites) ? raw.invites : [];
    const byCode = new Map(db.invites.map((i) => [i.code, i]));
    for (const di of disk) {
      const mem = byCode.get(di.code);
      if (!mem) {
        db.invites.push(di);
      } else if (di.usedBy && !mem.usedBy) {
        mem.usedBy = di.usedBy;
        mem.usedAt = di.usedAt;
      }
    }
  } catch (e) { /* 数据文件暂不可读时忽略 */ }
}

/* 云端模式：把 Postgres 里新增/已使用的邀请码合并进内存（多实例共用同一数据库的场景） */
async function syncInvitesFromDb() {
  if (!pgPool) return;
  try {
    const r = await pgPool.query("select data from app_state where id = $1", [STORE_ID]);
    if (!r.rows.length) return;
    const disk = Array.isArray(r.rows[0].data.invites) ? r.rows[0].data.invites : [];
    const byCode = new Map(db.invites.map((i) => [i.code, i]));
    for (const di of disk) {
      const mem = byCode.get(di.code);
      if (!mem) {
        db.invites.push(di);
      } else if (di.usedBy && !mem.usedBy) {
        mem.usedBy = di.usedBy;
        mem.usedAt = di.usedAt;
      }
    }
  } catch (e) { /* 数据库暂不可读时忽略 */ }
}

const newId = () => crypto.randomBytes(16).toString("hex");
const newToken = () => crypto.randomBytes(32).toString("hex");
const hashPassword = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString("hex");
const safeEqual = (a, b) =>
  a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/* 一次性邀请码：8 位，去掉了易混淆字符 */
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function generateInviteCode() {
  const part = (n) =>
    Array.from({ length: n }, () => INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)]).join("");
  return part(4) + "-" + part(4);
}
function normalizeInviteCode(s) {
  return String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/* ---------- HTTP 小工具 ---------- */
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(new Error("JSON 格式错误"));
      }
    });
    req.on("error", reject);
  });
}

function getSession(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const s = db.sessions.find((x) => x.token === m[1]);
  if (!s) return null;
  if (Date.now() > s.expires) {
    db.sessions = db.sessions.filter((x) => x !== s);
    saveDb();
    return null;
  }
  const u = db.users.find((x) => x.id === s.userId);
  if (u) u.lastSeen = Date.now(); // 在线状态：记录最近一次访问
  return u ? { user: u, session: s } : null;
}

function requireAuth(req, res) {
  const a = getSession(req);
  if (!a) {
    json(res, 401, { error: "请先登录" });
    return null;
  }
  return a;
}

const RE_USERNAME = /^[A-Za-z0-9_\u4e00-\u9fa5-]{2,20}$/;
function cleanItems(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (const v of arr) {
    const s = String(v).trim();
    if (!s) continue;
    if (s.length > 120) return null;
    out.push(s);
  }
  if (out.length > 2000) return null;
  return out;
}

function publicSheet(s) {
  return { id: s.id, name: s.name, count: s.items.length, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

function articleSummary(a, withContent) {
  const base = {
    id: a.id,
    title: a.title,
    username: a.username,
    isPublic: a.isPublic,
    commentCount: db.comments.filter((c) => c.articleId === a.id).length,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt
  };
  if (withContent) base.content = a.content;
  else base.excerpt = a.content.slice(0, 120);
  return base;
}

/* ---------- 路由 ---------- */
const routes = {};

async function handleApi(req, res, url) {
  const segs = url.pathname.split("/").filter(Boolean); // ["api", ...]
  for (const [key, handler] of Object.entries(routes)) {
    const sp = key.indexOf(" ");
    const method = key.slice(0, sp);
    const patSegs = key.slice(sp + 1).split("/");
    if (method !== req.method || patSegs.length !== segs.length) continue;
    let match = true;
    for (let i = 0; i < patSegs.length; i++) {
      if (!patSegs[i].startsWith(":")) {
        if (patSegs[i] !== segs[i]) { match = false; break; }
      }
    }
    if (!match) continue;
    try {
      await handler(req, res, url, segs);
    } catch (e) {
      json(res, 400, { error: e.message });
    }
    return;
  }
  json(res, 404, { error: "接口不存在" });
}

/* —— 健康检查 —— */
routes["GET api/health"] = (req, res) => json(res, 200, { ok: true, name: "rhein-terminal", time: Date.now() });

/* —— 账号 —— */
routes["POST api/register"] = async (req, res) => {
  const body = await readBody(req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!RE_USERNAME.test(username)) return json(res, 400, { error: "用户名需为 2–20 位字母、数字、中文、下划线或连字符" });
  if (password.length < 6 || password.length > 72) return json(res, 400, { error: "密码长度需为 6–72 位" });
  if (db.users.some((u) => u.username === username)) return json(res, 409, { error: "用户名已被占用" });
  /* 邀请制：注册必须携带有效且未使用的一次性邀请码 */
  if (pgPool) await syncInvitesFromDb(); // 云端模式：从 Postgres 同步新生成的码
  else syncInvitesFromDisk(); // 本地模式：从 data/db.json 同步
  const code = normalizeInviteCode(body.inviteCode);
  if (!code) return json(res, 400, { error: "请填写邀请码（向圈主索取）" });
  /* 存储的码可能带连字符（如 9T4K-AX8G），比对时两侧都规范化 */
  const invite = db.invites.find((x) => normalizeInviteCode(x.code) === code);
  if (!invite || invite.usedBy) return json(res, 403, { error: "邀请码无效或已被使用" });
  const salt = crypto.randomBytes(16).toString("hex");
  const user = { id: newId(), username, salt, hash: hashPassword(password, salt), createdAt: Date.now() };
  db.users.push(user);
  invite.usedBy = user.id;
  invite.usedAt = Date.now();
  const token = newToken();
  db.sessions.push({ token, userId: user.id, expires: Date.now() + SESSION_TTL });
  saveDb();
  json(res, 200, { token, username: user.username });
};

routes["POST api/login"] = async (req, res) => {
  const body = await readBody(req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const user = db.users.find((u) => u.username === username);
  if (!user || !safeEqual(hashPassword(password, user.salt), user.hash)) {
    return json(res, 401, { error: "用户名或密码不正确" });
  }
  const token = newToken();
  db.sessions.push({ token, userId: user.id, expires: Date.now() + SESSION_TTL });
  saveDb();
  json(res, 200, { token, username: user.username });
};

routes["POST api/logout"] = (req, res) => {
  const a = getSession(req);
  if (a) {
    db.sessions = db.sessions.filter((s) => s !== a.session);
    saveDb();
  }
  json(res, 200, { ok: true });
};

routes["GET api/me"] = (req, res) => {
  const a = requireAuth(req, res);
  if (!a) return;
  json(res, 200, { id: a.user.id, username: a.user.username, avatar: a.user.avatar || null, isAdmin: Boolean(a.user.isAdmin) });
};

/* 自定义头像：色块 color:#rrggbb / data:image/*（≤120KB）/ 旧版 emoji；空值恢复默认 */
routes["PUT api/me/avatar"] = async (req, res) => {
  const a = requireAuth(req, res);
  if (!a) return;
  const body = await readBody(req);
  const avatar = body.avatar;
  if (avatar !== null && avatar !== undefined && typeof avatar !== "string") {
    return json(res, 400, { error: "头像格式不正确" });
  }
  if (typeof avatar === "string" && avatar.trim()) {
    const v = avatar.trim();
    if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(v)) {
      if (v.length > 120000) return json(res, 400, { error: "头像图片过大（请小于 90KB）" });
    } else if (/^color:#[0-9a-f]{6}$/i.test(v)) {
      /* 色块头像：合法 */
    } else if (v.length > 16) {
      return json(res, 400, { error: "头像字符过长" });
    }
    a.user.avatar = v;
  } else {
    a.user.avatar = null;
  }
  saveDb();
  json(res, 200, { avatar: a.user.avatar });
};

/* —— 管理员 —— */
function requireAdmin(req, res) {
  const a = requireAuth(req, res);
  if (!a) return null;
  if (!a.user.isAdmin) {
    json(res, 403, { error: "需要管理员权限" });
    return null;
  }
  return a;
}

routes["GET api/admin/users"] = (req, res) => {
  const a = requireAdmin(req, res);
  if (!a) return;
  const now = Date.now();
  const users = db.users.map((u) => {
    const lastSeen = Number(u.lastSeen) || 0;
    return {
      username: u.username,
      avatar: u.avatar || null,
      isAdmin: Boolean(u.isAdmin),
      createdAt: u.createdAt,
      lastSeen,
      online: lastSeen > 0 && now - lastSeen < ONLINE_WINDOW
    };
  });
  json(res, 200, { users });
};

routes["GET api/admin/settings"] = (req, res) => {
  const a = requireAdmin(req, res);
  if (!a) return;
  json(res, 200, { settings: db.settings, version: { version: VERSION_INFO.version, build: VERSION_INFO.build } });
};

routes["PUT api/admin/settings"] = async (req, res) => {
  const a = requireAdmin(req, res);
  if (!a) return;
  const body = await readBody(req);
  /* 版本号与更新日志是只读的（来自 version.json），不在这里修改 */
  const fields = ["siteName", "heroTitle", "heroSub", "footerText", "announcement"];
  for (const k of fields) {
    if (typeof body[k] === "string") {
      const max = (k === "heroTitle" || k === "heroSub" || k === "announcement") ? 2000 : 200;
      db.settings[k] = body[k].slice(0, max);
    }
  }
  saveDb();
  json(res, 200, { settings: db.settings });
};

/* 公开站点设置（首页渲染用，不含敏感信息） */
routes["GET api/settings"] = (req, res) => {
  const latest = VERSION_INFO.changelog[0];
  json(res, 200, {
    siteName: db.settings.siteName,
    heroTitle: db.settings.heroTitle,
    heroSub: db.settings.heroSub,
    footerText: db.settings.footerText,
    announcement: db.settings.announcement,
    version: VERSION_INFO.version,
    build: VERSION_INFO.build,
    updates: latest ? (latest.title || (latest.items || [])[0] || "") : ""
  });
};

/* 版本与更新日志（只读，来自仓库 version.json） */
routes["GET api/version"] = (req, res) => {
  json(res, 200, {
    version: VERSION_INFO.version,
    build: VERSION_INFO.build,
    changelog: VERSION_INFO.changelog
  });
};

/* —— 外卖商品名（爬虫推送，管理员写入 / 所有人读取） —— */
routes["GET api/waimai"] = (req, res) => {
  json(res, 200, {
    source: db.waimai.source || "",
    updatedAt: db.waimai.updatedAt || 0,
    items: db.waimai.items || []
  });
};

routes["PUT api/waimai"] = async (req, res) => {
  const a = requireAdmin(req, res);
  if (!a) return;
  const body = await readBody(req);
  const raw = Array.isArray(body.items) ? body.items : [];
  const seen = new Set();
  const items = [];
  raw.forEach((x) => {
    const item = normalizeWaimaiItem(x);
    if (!item) return;
    const key = item.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  });
  if (!items.length) return json(res, 400, { error: "商品名不能为空" });
  db.waimai = {
    source: String(body.source || "manual").slice(0, 40),
    updatedAt: Date.now(),
    items: items.slice(0, 500)
  };
  saveDb();
  json(res, 200, { source: db.waimai.source, updatedAt: db.waimai.updatedAt, count: db.waimai.items.length });
};

routes["DELETE api/waimai"] = (req, res) => {
  const a = requireAdmin(req, res);
  if (!a) return;
  db.waimai = { source: "", updatedAt: Date.now(), items: [] };
  saveDb();
  json(res, 200, { ok: true });
};

/* —— 邀请码（管理员） —— */
routes["GET api/admin/invites"] = (req, res) => {
  const a = requireAdmin(req, res);
  if (!a) return;
  const unused = db.invites.filter((i) => !i.usedBy).map((i) => i.code);
  json(res, 200, { unused, total: db.invites.length, used: db.invites.length - unused.length });
};

routes["POST api/admin/invites"] = async (req, res) => {
  const a = requireAdmin(req, res);
  if (!a) return;
  const body = await readBody(req);
  const n = Math.max(1, Math.min(50, parseInt(body.count, 10) || 1));
  const codes = [];
  for (let i = 0; i < n; i++) {
    const code = generateInviteCode();
    db.invites.push({ code, usedBy: null, usedAt: null, createdAt: Date.now() });
    codes.push(code);
  }
  saveDb();
  json(res, 200, { codes, total: db.invites.length, unused: db.invites.filter((i) => !i.usedBy).length });
};

/* —— 云端清单（sheet） —— */
function findSheet(req, res, id) {
  const a = requireAuth(req, res);
  if (!a) return null;
  const s = db.sheets.find((x) => x.id === id && x.owner === a.user.id);
  if (!s) json(res, 404, { error: "清单不存在" });
  return s;
}

routes["GET api/sheets"] = (req, res) => {
  const a = requireAuth(req, res);
  if (!a) return;
  const list = db.sheets
    .filter((s) => s.owner === a.user.id)
    .sort((x, y) => y.updatedAt - x.updatedAt)
    .map(publicSheet);
  json(res, 200, { sheets: list });
};

routes["POST api/sheets"] = async (req, res) => {
  const a = requireAuth(req, res);
  if (!a) return;
  const body = await readBody(req);
  const name = String(body.name || "").trim();
  if (!name || name.length > 40) return json(res, 400, { error: "清单名称需为 1–40 字" });
  const items = cleanItems(body.items || []);
  if (items === null) return json(res, 400, { error: "清单条目格式不正确" });
  const now = Date.now();
  const sheet = { id: newId(), owner: a.user.id, name, items, createdAt: now, updatedAt: now };
  db.sheets.push(sheet);
  saveDb();
  json(res, 200, { sheet: publicSheet(sheet), items: sheet.items });
};

routes["GET api/sheets/:id"] = (req, res, url, parts) => {
  const sheet = findSheet(req, res, parts[2]);
  if (!sheet) return;
  json(res, 200, { sheet: publicSheet(sheet), items: sheet.items });
};

routes["PUT api/sheets/:id"] = async (req, res, url, parts) => {
  const sheet = findSheet(req, res, parts[2]);
  if (!sheet) return;
  const body = await readBody(req);
  if (body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name || name.length > 40) return json(res, 400, { error: "清单名称需为 1–40 字" });
    sheet.name = name;
  }
  if (body.items !== undefined) {
    const items = cleanItems(body.items);
    if (items === null) return json(res, 400, { error: "清单条目格式不正确" });
    sheet.items = items;
  }
  sheet.updatedAt = Date.now();
  saveDb();
  json(res, 200, { sheet: publicSheet(sheet), items: sheet.items });
};

routes["DELETE api/sheets/:id"] = (req, res, url, parts) => {
  const sheet = findSheet(req, res, parts[2]);
  if (!sheet) return;
  db.sheets = db.sheets.filter((x) => x !== sheet);
  saveDb();
  json(res, 200, { ok: true });
};

/* —— 文章广场 —— */
function findArticle(req, res, id) {
  const a = requireAuth(req, res);
  if (!a) return null;
  const art = db.articles.find((x) => x.id === id);
  if (!art) {
    json(res, 404, { error: "文章不存在" });
    return null;
  }
  if (!art.isPublic && art.owner !== a.user.id) {
    json(res, 403, { error: "这是一篇私密文章" });
    return null;
  }
  return art;
}

routes["GET api/articles"] = (req, res) => {
  const a = requireAuth(req, res);
  if (!a) return; // 未登录：全部视为私密，不返回任何文章
  const list = db.articles
    .filter((x) => x.isPublic || x.owner === a.user.id)
    .sort((x, y) => y.updatedAt - x.updatedAt)
    .map((x) => articleSummary(x, false));
  json(res, 200, { articles: list });
};

routes["POST api/articles"] = async (req, res) => {
  const a = requireAuth(req, res);
  if (!a) return;
  const body = await readBody(req);
  const title = String(body.title || "").trim();
  const content = String(body.content || "");
  const isPublic = body.isPublic === true;
  if (!title || title.length > 100) return json(res, 400, { error: "标题需为 1–100 字" });
  if (!content.trim() || content.length > 50000) return json(res, 400, { error: "正文不能为空且不超过 50000 字" });
  const now = Date.now();
  const art = { id: newId(), owner: a.user.id, username: a.user.username, title, content, isPublic, createdAt: now, updatedAt: now };
  db.articles.push(art);
  saveDb();
  json(res, 200, { article: articleSummary(art, true) });
};

routes["GET api/articles/:id"] = (req, res, url, parts) => {
  const art = findArticle(req, res, parts[2]);
  if (!art) return;
  json(res, 200, { article: articleSummary(art, true) });
};

routes["PUT api/articles/:id"] = async (req, res, url, parts) => {
  const a = requireAuth(req, res);
  if (!a) return;
  const art = db.articles.find((x) => x.id === parts[2]);
  if (!art) return json(res, 404, { error: "文章不存在" });
  if (art.owner !== a.user.id) return json(res, 403, { error: "只能编辑自己的文章" });
  const body = await readBody(req);
  if (body.title !== undefined) {
    const title = String(body.title || "").trim();
    if (!title || title.length > 100) return json(res, 400, { error: "标题需为 1–100 字" });
    art.title = title;
  }
  if (body.content !== undefined) {
    const content = String(body.content || "");
    if (!content.trim() || content.length > 50000) return json(res, 400, { error: "正文不能为空且不超过 50000 字" });
    art.content = content;
  }
  if (body.isPublic !== undefined) art.isPublic = body.isPublic === true;
  art.updatedAt = Date.now();
  saveDb();
  json(res, 200, { article: articleSummary(art, true) });
};

routes["DELETE api/articles/:id"] = (req, res, url, parts) => {
  const a = requireAuth(req, res);
  if (!a) return;
  const art = db.articles.find((x) => x.id === parts[2]);
  if (!art) return json(res, 404, { error: "文章不存在" });
  if (art.owner !== a.user.id) return json(res, 403, { error: "只能删除自己的文章" });
  db.articles = db.articles.filter((x) => x !== art);
  db.comments = db.comments.filter((c) => c.articleId !== art.id);
  saveDb();
  json(res, 200, { ok: true });
};

/* —— 评论（登录后可用；权限随文章：他人私密文章不可见也不可评） —— */
function commentSummary(c, viewerId) {
  const author = db.users.find((u) => u.id === c.userId);
  return {
    id: c.id,
    username: c.username,
    avatar: (author && author.avatar) || null,
    content: c.content,
    createdAt: c.createdAt,
    mine: c.userId === viewerId
  };
}

routes["GET api/articles/:id/comments"] = (req, res, url, parts) => {
  const art = findArticle(req, res, parts[2]);
  if (!art) return;
  const a = getSession(req);
  const list = db.comments
    .filter((c) => c.articleId === art.id)
    .sort((x, y) => x.createdAt - y.createdAt)
    .map((c) => commentSummary(c, a.user.id));
  json(res, 200, { comments: list });
};

routes["POST api/articles/:id/comments"] = async (req, res, url, parts) => {
  const art = findArticle(req, res, parts[2]);
  if (!art) return;
  const a = getSession(req);
  const body = await readBody(req);
  const content = String(body.content || "").trim();
  if (!content || content.length > 2000) return json(res, 400, { error: "评论需为 1–2000 字" });
  const c = { id: newId(), articleId: art.id, userId: a.user.id, username: a.user.username, content, createdAt: Date.now() };
  db.comments.push(c);
  saveDb();
  json(res, 200, { comment: commentSummary(c, a.user.id) });
};

routes["DELETE api/comments/:id"] = (req, res, url, parts) => {
  const a = requireAuth(req, res);
  if (!a) return;
  const c = db.comments.find((x) => x.id === parts[2]);
  if (!c) return json(res, 404, { error: "评论不存在" });
  if (c.userId !== a.user.id) return json(res, 403, { error: "只能删除自己的评论" });
  db.comments = db.comments.filter((x) => x !== c);
  saveDb();
  json(res, 200, { ok: true });
};

/* ---------- 静态文件 ---------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

/* 静态资源白名单：只暴露前端需要的文件，其余一律 403 */
const STATIC_FILES = new Set(["/index.html", "/styles.css", "/app.js", "/version.json"]);

function serveStatic(req, res, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch (e) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Bad Request");
  }
  const norm = path.posix.normalize(rel);
  if (!STATIC_FILES.has(norm)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }
  const file = path.join(ROOT, norm);
  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

/* ---------- 主服务 ---------- */
const cliArgs = process.argv.slice(2);

(async () => {
  await initStore();

  /* 圈主命令行工具（不启动服务，执行后退出） */
  if (cliArgs[0] === "--invite") {
    const n = Math.max(1, Math.min(200, parseInt(cliArgs[1], 10) || 3));
    const codes = [];
    for (let i = 0; i < n; i++) {
      const code = generateInviteCode();
      db.invites.push({ code, usedBy: null, usedAt: null, createdAt: Date.now() });
      codes.push(code);
    }
    await saveDb();
    console.log("已生成 " + n + " 个一次性邀请码（每个只能注册一个账号）：");
    codes.forEach((c) => console.log("  " + c));
    process.exit(0);
  }
  if (cliArgs[0] === "--users") {
    if (!db.users.length) {
      console.log("还没有注册用户。");
    } else {
      console.log("注册用户（" + db.users.length + " 人）：");
      db.users.forEach((u) =>
        console.log("  " + u.username + "\t" + new Date(u.createdAt).toLocaleString("zh-CN"))
      );
    }
    const unused = db.invites.filter((i) => !i.usedBy).length;
    console.log("剩余可用邀请码：" + unused + " 个");
    process.exit(0);
  }

  if (cliArgs[0] === "--make-admin" && cliArgs[1]) {
    const name = cliArgs[1];
    const u = db.users.find((x) => x.username === name);
    if (!u) {
      console.error("未找到用户：" + name);
      process.exit(1);
    }
    u.isAdmin = true;
    await saveDb();
    console.log("已将 " + name + " 设为管理员。");
    process.exit(0);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
    serveStatic(req, res, url.pathname);
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.error("启动失败：端口 " + PORT + " 已被占用。请先关闭旧的服务器窗口，或运行 taskkill /f /im node.exe 后重试。");
      process.exit(1);
    }
    console.error("服务器错误:", e.message);
    process.exit(1);
  });

  server.listen(PORT, () => {
    console.log("RHEIN TERMINAL 已启动");
    console.log("  本机访问:   http://localhost:" + PORT);
    console.log("  数据:       " + (pgPool ? "云端 PostgreSQL" : DATA_DIR));
  });

  /* 云端部署：收到停止信号前把未写完的数据刷到数据库 */
  const flush = async () => {
    try { await writeChain; } catch (e) { /* 忽略 */ }
    process.exit(0);
  };
  process.on("SIGTERM", flush);
  process.on("SIGINT", flush);
})();
