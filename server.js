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
const DATA_DIR = process.env.RHINE_DATA || path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const PORT = Number(process.env.PORT || 8000);
const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 天

/* ---------- 数据层 ---------- */
let db = { users: [], sheets: [], articles: [], sessions: [] };

function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    db = { users: [], sheets: [], articles: [], sessions: [] };
  }
}

function saveDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_PATH);
}

const newId = () => crypto.randomBytes(16).toString("hex");
const newToken = () => crypto.randomBytes(32).toString("hex");
const hashPassword = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString("hex");
const safeEqual = (a, b) =>
  a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

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
  const salt = crypto.randomBytes(16).toString("hex");
  const user = { id: newId(), username, salt, hash: hashPassword(password, salt), createdAt: Date.now() };
  db.users.push(user);
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
  json(res, 200, { id: a.user.id, username: a.user.username });
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

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  /* 安全：禁止暴露数据目录与服务器/测试源码 */
  const base = path.basename(file);
  if (rel.split("/").includes("data") || base === "server.js" || base.endsWith(".test.mjs")) {
    res.writeHead(403);
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
loadDb();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log("RHEIN TERMINAL 已启动");
  console.log("  本机访问:   http://localhost:" + PORT);
  console.log("  局域网分享: http://<本机IP>:" + PORT + "   (node server.js)");
  console.log("  数据目录:   " + DATA_DIR);
});
