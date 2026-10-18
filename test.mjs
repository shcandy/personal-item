/* 前端功能测试（jsdom + 内存版 fetch 桩，模拟 server.js 行为） */
import { JSDOM, VirtualConsole } from "./_tools/node_modules/jsdom/lib/api.js";
import { readFileSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const htmlSrc = readFileSync(dir + "index.html", "utf8");
const jsSrc = readFileSync(dir + "app.js", "utf8");

/* ---------- 内存版后端 ---------- */
const fakeDB = {
  users: [],
  sessions: [],
  sheets: [],
  articles: [],
  seq: 1
};
const reqLog = [];
const uid = () => "u" + fakeDB.seq++;
const tid = () => "t" + fakeDB.seq++;

function stubFetch(window) {
  window.fetch = async (path, opts = {}) => {
    reqLog.push({ path, method: opts.method || "GET" });
    const method = opts.method || "GET";
    const body = opts.body ? JSON.parse(opts.body) : {};
    const header = (opts.headers && opts.headers.Authorization) || "";
    const token = header.replace(/^Bearer\s+/, "");
    const session = token ? fakeDB.sessions.find((s) => s.token === token) : null;
    const user = session ? fakeDB.users.find((u) => u.id === session.userId) : null;
    const res = (status, obj) => ({ ok: status < 400, status, json: async () => obj });
    const unauth = () => res(401, { error: "请先登录" });

    /* 健康检查 */
    if (path === "/api/health") return res(200, { ok: true });

    /* 账号 */
    if (path === "/api/register" && method === "POST") {
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      if (username.length < 2 || password.length < 6) return res(400, { error: "格式不正确" });
      if (fakeDB.users.some((u) => u.username === username)) return res(409, { error: "用户名已被占用" });
      const u = { id: uid(), username, password };
      fakeDB.users.push(u);
      const t = { token: tid(), userId: u.id };
      fakeDB.sessions.push(t);
      return res(200, { token: t.token, username });
    }
    if (path === "/api/login" && method === "POST") {
      const u = fakeDB.users.find((x) => x.username === String(body.username || "").trim());
      if (!u || u.password !== String(body.password || "")) return res(401, { error: "用户名或密码不正确" });
      const t = { token: tid(), userId: u.id };
      fakeDB.sessions.push(t);
      return res(200, { token: t.token, username: u.username });
    }
    if (path === "/api/logout" && method === "POST") {
      if (session) fakeDB.sessions = fakeDB.sessions.filter((s) => s !== session);
      return res(200, { ok: true });
    }
    if (path === "/api/me" && method === "GET") {
      if (!user) return unauth();
      return res(200, { id: user.id, username: user.username });
    }

    /* 云端清单 */
    if (path === "/api/sheets" && method === "GET") {
      if (!user) return unauth();
      const list = fakeDB.sheets
        .filter((s) => s.owner === user.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((s) => ({ id: s.id, name: s.name, count: s.items.length, createdAt: s.createdAt, updatedAt: s.updatedAt }));
      return res(200, { sheets: list });
    }
    if (path === "/api/sheets" && method === "POST") {
      if (!user) return unauth();
      const name = String(body.name || "").trim();
      if (!name) return res(400, { error: "清单名称不能为空" });
      const items = (body.items || []).map((s) => String(s).trim()).filter(Boolean);
      const now = Date.now();
      const sheet = { id: uid(), owner: user.id, name, items, createdAt: now, updatedAt: now };
      fakeDB.sheets.push(sheet);
      return res(200, { sheet: { id: sheet.id, name: sheet.name, count: sheet.items.length, createdAt: now, updatedAt: now }, items: sheet.items });
    }
    let m = path.match(/^\/api\/sheets\/([^/]+)$/);
    if (m) {
      const sheet = fakeDB.sheets.find((s) => s.id === m[1]);
      if (!user) return unauth();
      if (!sheet || sheet.owner !== user.id) return res(404, { error: "清单不存在" });
      if (method === "GET") return res(200, { sheet: { id: sheet.id, name: sheet.name, count: sheet.items.length, createdAt: sheet.createdAt, updatedAt: sheet.updatedAt }, items: sheet.items });
      if (method === "PUT") {
        if (body.name !== undefined) sheet.name = String(body.name).trim();
        if (body.items !== undefined) sheet.items = body.items.map((s) => String(s).trim()).filter(Boolean);
        sheet.updatedAt = Date.now();
        return res(200, { sheet: { id: sheet.id, name: sheet.name, count: sheet.items.length, createdAt: sheet.createdAt, updatedAt: sheet.updatedAt }, items: sheet.items });
      }
      if (method === "DELETE") {
        fakeDB.sheets = fakeDB.sheets.filter((s) => s !== sheet);
        return res(200, { ok: true });
      }
    }

    /* 文章广场 */
    if (path === "/api/articles" && method === "GET") {
      if (!user) return unauth();
      const list = fakeDB.articles
        .filter((a) => a.isPublic || a.owner === user.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((a) => ({
          id: a.id, title: a.title, username: a.username, isPublic: a.isPublic,
          excerpt: a.content.slice(0, 120), createdAt: a.createdAt, updatedAt: a.updatedAt
        }));
      return res(200, { articles: list });
    }
    if (path === "/api/articles" && method === "POST") {
      if (!user) return unauth();
      const title = String(body.title || "").trim();
      const content = String(body.content || "");
      if (!title || !content.trim()) return res(400, { error: "标题与正文不能为空" });
      const now = Date.now();
      const a = { id: uid(), owner: user.id, username: user.username, title, content, isPublic: body.isPublic === true, createdAt: now, updatedAt: now };
      fakeDB.articles.push(a);
      return res(200, { article: { id: a.id, title: a.title, username: a.username, isPublic: a.isPublic, content: a.content, createdAt: now, updatedAt: now } });
    }
    m = path.match(/^\/api\/articles\/([^/]+)$/);
    if (m) {
      const a = fakeDB.articles.find((x) => x.id === m[1]);
      if (!user) return unauth();
      if (!a) return res(404, { error: "文章不存在" });
      if (!a.isPublic && a.owner !== user.id) return res(403, { error: "这是一篇私密文章" });
      if (method === "GET") return res(200, { article: { id: a.id, title: a.title, username: a.username, isPublic: a.isPublic, content: a.content, createdAt: a.createdAt, updatedAt: a.updatedAt } });
      if (method === "PUT") {
        if (a.owner !== user.id) return res(403, { error: "只能编辑自己的文章" });
        if (body.title !== undefined) a.title = String(body.title).trim();
        if (body.content !== undefined) a.content = String(body.content);
        if (body.isPublic !== undefined) a.isPublic = body.isPublic === true;
        a.updatedAt = Date.now();
        return res(200, { article: { id: a.id, title: a.title, username: a.username, isPublic: a.isPublic, content: a.content, createdAt: a.createdAt, updatedAt: a.updatedAt } });
      }
      if (method === "DELETE") {
        if (a.owner !== user.id) return res(403, { error: "只能删除自己的文章" });
        fakeDB.articles = fakeDB.articles.filter((x) => x !== a);
        return res(200, { ok: true });
      }
    }
    return res(404, { error: "接口不存在" });
  };
}

/* ---------- 加载页面 ---------- */
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + (e.detail || e.message)));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const html = htmlSrc.replace(
  '<script src="app.js"></script>',
  () => "<script>" + jsSrc + "</script>"
);

const dom = new JSDOM(html, {
  url: "http://localhost/",
  runScripts: "dangerously",
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    window.HTMLElement.prototype.scrollIntoView = function () {};
    stubFetch(window);
    window.addEventListener("error", (e) => errors.push("window.onerror: " + e.message));
  }
});

const { window } = dom;
const { document } = window;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const results = [];
function assert(cond, msg) {
  if (cond) { pass++; results.push("PASS  " + msg); }
  else { fail++; results.push("FAIL  " + msg); }
}
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const setVal = (el, v) => { el.value = v; el.dispatchEvent(new window.Event("input", { bubbles: true })); };

await sleep(300);

/* ---------- 初始渲染与健康检查 ---------- */
assert($("#previewCount").textContent === "25", "首页预览显示 25 项内置预设");
assert(/^\d{2}:\d{2}:\d{2}$/.test($("#headerClock").textContent), "顶栏时钟正常渲染");
assert($("#focusPreview").textContent === "25:00", "专注卡片预览 25:00");
assert($("#serverChip").textContent.includes("在线服务"), "健康检查后显示在线服务");
assert($("#userName").textContent === "登录", "初始为未登录状态");

/* ---------- 访客状态：清单与广场均锁定 ---------- */
click(document.querySelector('[data-module="random"]'));
assert(!$("#modalRandom").hidden, "打开随机选择器弹窗");
assert($("#presetPool").children.length === 25, "预设池渲染 25 项");
click($('.tab[data-tab="sheets"]'));
assert($("#sheetsGuest").hidden === false, "未登录时我的清单显示登录引导");
assert($("#sheetsMain").hidden === true, "未登录时清单主体隐藏");
document.querySelector('#modalRandom [data-close]').click();

click(document.querySelector('[data-module="plaza"]'));
assert($("#plazaLock").hidden === false, "未登录时文章广场全部私密（锁定视图）");
assert($("#plazaMain").hidden === true, "未登录时广场列表隐藏");

/* 从广场锁屏注册账号 alice，成功后应返回广场 */
click($('#plazaLock [data-open-auth]'));
assert(!$("#modalAuth").hidden, "锁屏登录按钮打开认证弹窗");
click($("#authSwitch"));
assert($("#authTitle").textContent === "创建账号", "切换到注册模式");
setVal($("#authUser"), "alice");
setVal($("#authPass"), "secret123");
click($("#authSubmit"));
await sleep(150);
assert($("#userName").textContent === "alice", "注册成功后顶栏显示用户名");
assert($("#modalAuth").hidden, "认证弹窗已关闭");
assert(!$("#modalPlaza").hidden, "注册成功返回文章广场");
assert($("#plazaMain").hidden === false, "登录后广场解锁");
document.querySelector('#modalPlaza [data-close]').click();

/* ---------- 云端清单：创建 / 抽取 / 移除 / 重命名 / 删除 ---------- */
click(document.querySelector('[data-module="random"]'));
click($('.tab[data-tab="sheets"]'));
assert($("#sheetsGuest").hidden === true, "登录后清单引导隐藏");
assert($("#sheetsMain").hidden === false, "登录后清单主体显示");
click($("#sheetNewBtn"));
assert($("#newSheetBox").hidden === false, "新建清单表单展开");
setVal($("#newSheetName"), "午餐候选");
setVal($("#newSheetItems"), "番茄牛腩饭\n麻辣香锅\n豚骨拉面");
click($("#newSheetSave"));
await sleep(200);
assert($("#sheetTabs").querySelectorAll(".sheet-tab").length === 1, "清单标签渲染 1 个");
assert($("#sheetPool").querySelectorAll(".item-chip").length === 3, "清单内容渲染 3 项");
assert($("#execNote").textContent.includes("当前池 3 项"), "活动池切到云端清单");

click($("#execBtn"));
await sleep(1600);
assert($("#resultGrid").querySelectorAll(".result-card").length === 1, "从云端清单抽取成功");

/* 逐项移除 */
click($("#sheetPool .item-chip .del"));
await sleep(120);
assert($("#sheetPool").querySelectorAll(".item-chip").length === 2, "清单逐项移除后剩 2 项");
assert($("#execNote").textContent.includes("当前池 2 项"), "移除后池大小同步更新");

/* 添加条目 */
setVal($("#sheetAddInput"), "寿司拼盘");
click($("#sheetAddBtn"));
await sleep(120);
assert($("#sheetPool").querySelectorAll(".item-chip").length === 3, "添加条目后清单 3 项");

/* 重命名 */
click($("#sheetRenameBtn"));
assert($("#renameBox").hidden === false, "重命名表单展开");
setVal($("#renameInput"), "午餐候选V2");
click($("#renameSave"));
await sleep(120);
assert($("#sheetTabs").textContent.includes("午餐候选V2"), "清单重命名生效");

/* 删除清单（两步确认） */
click($("#sheetDeleteBtn"));
assert($("#sheetDeleteBtn").textContent.includes("确认删除"), "删除需二次确认");
click($("#sheetDeleteBtn"));
await sleep(200);
assert($("#sheetTabs").querySelectorAll(".sheet-tab").length === 0, "清单已删除");

/* ---------- 临时导入：不可一键清空 ---------- */
click($('.tab[data-tab="import"]'));
assert(document.getElementById("importClear") === null, "临时导入不存在一键清空按钮");
setVal($("#pasteArea"), "苹果\n香蕉\n樱桃\n苹果");
click($("#parsePaste"));
assert($("#importPool").querySelectorAll(".item-chip").length === 3, "粘贴导入解析 3 项（自动去重）");
assert($("#execNote").textContent.includes("当前池 3 项"), "活动池切到临时导入");

click($("#execBtn"));
await sleep(1600);
assert($("#historyList").children.length === 2, "抽取历史累计 2 条");
assert($("#historySec").hidden === false, "历史区显示");

/* 清空记录不影响名单 */
click($("#clearHistBtn"));
assert($("#historySec").hidden === true, "清空本次记录后历史区隐藏");
assert($("#importPool").querySelectorAll(".item-chip").length === 3, "清空记录后导入名单保持 3 项");

/* 逐项移除临时导入 */
click($("#importPool .item-chip .del"));
assert($("#importPool").querySelectorAll(".item-chip").length === 2, "临时导入逐项移除后剩 2 项");

/* 存为我的清单 */
click($("#saveToSheetBtn"));
assert($("#saveSheetBox").hidden === false, "存为清单表单展开");
setVal($("#saveSheetInput"), "水果清单");
click($("#saveSheetConfirm"));
await sleep(200);
assert($("#saveSheetBox").hidden === true, "保存后表单收起");
const savedSheets = fakeDB.sheets.filter((s) => s.name === "水果清单");
assert(savedSheets.length === 1 && savedSheets[0].items.length === 2, "临时名单已存为云端清单");
document.querySelector('#modalRandom [data-close]').click();

/* ---------- 文章广场：发布 / 阅读 / 编辑 / 权限 ---------- */
click(document.querySelector('[data-module="plaza"]'));
await sleep(150);
click($("#plazaNewBtn"));
assert($("#plazaEditor").hidden === false, "写文章编辑器打开");
setVal($("#editorTitle"), "公开文章");
setVal($("#editorContent"), "这是 alice 的公开内容。");
click($("#editorPublic"));
assert($("#editorPublicLabel").textContent === "所有人可见", "公开开关切换");
click($("#editorSave"));
await sleep(200);
assert($("#plazaList").querySelectorAll(".article-row").length === 1, "公开文章发布后列表 1 条");
assert($("#plazaList").textContent.includes("公开"), "公开文章带公开标记");

click($("#plazaNewBtn"));
setVal($("#editorTitle"), "私密文章");
setVal($("#editorContent"), "这是 alice 的私密内容。");
click($("#editorSave"));
await sleep(200);
assert($("#plazaList").querySelectorAll(".article-row").length === 2, "私密文章保存后列表 2 条");

click($("#plazaFilterMine"));
assert($("#plazaList").querySelectorAll(".article-row").length === 2, "「我写的」筛选显示 2 条");
click($("#plazaFilterAll"));

/* 阅读窗口 */
click($("#plazaList .article-row"));
await sleep(150);
assert($("#plazaReader").hidden === false, "点击文章进入阅读窗口");
assert($("#readerBody").textContent.includes("私密内容"), "阅读窗口显示正文");
assert($("#readerActions").hidden === false, "作者可见编辑/删除操作");

/* 编辑文章 */
click($("#editArticleBtn"));
assert($("#plazaEditor").hidden === false, "编辑模式打开");
assert($("#editorTitle").value === "私密文章", "编辑器预填标题");
setVal($("#editorTitle"), "私密文章改");
click($("#editorSave"));
await sleep(200);
assert($("#plazaList").textContent.includes("私密文章改"), "编辑后列表标题更新");
assert($("#plazaList").querySelectorAll(".article-row").length === 2, "编辑后仍为 2 条");

/* 退出登录（广场内）→ 全部私密 */
click($("#userBtn"));
assert($("#accountPop").hidden === false, "账号弹层打开");
click($("#logoutBtn"));
await sleep(150);
assert($("#userName").textContent === "登录", "退出后顶栏恢复登录");
assert($("#plazaLock").hidden === false, "退出后广场立即回到锁定视图");
document.querySelector('#modalPlaza [data-close]').click();

/* ---------- 用户 bob：只能看到公开文章 ---------- */
click($("#userBtn"));
click($("#authSwitch"));
setVal($("#authUser"), "bob");
setVal($("#authPass"), "secret456");
click($("#authSubmit"));
await sleep(150);
assert($("#userName").textContent === "bob", "bob 注册并登录成功");

click(document.querySelector('[data-module="plaza"]'));
await sleep(200);
assert($("#plazaList").querySelectorAll(".article-row").length === 1, "bob 只看到 1 篇公开文章");
assert($("#plazaList").textContent.includes("公开文章"), "bob 可见的是公开文章");
assert(!$("#plazaList").textContent.includes("私密文章"), "bob 看不到 alice 的私密文章");
document.querySelector('#modalPlaza [data-close]').click();

/* ---------- 其他模块回归 ---------- */
click(document.querySelector('[data-module="focus"]'));
click($("#focusToggle"));
await sleep(2100);
assert($("#focusToggle").textContent === "暂停", "专注计时运行中");
click($("#focusToggle"));
click($("#focusReset"));
assert($("#focusDigits").textContent === "25:00", "专注计时重置");
document.querySelector('#modalFocus [data-close]').click();

click(document.querySelector('[data-module="dice"]'));
click($('#modalDice [data-dice="3"]'));
assert($("#diceBoard").querySelectorAll(".die").length === 3, "切换 3 枚骰子");
click($("#diceRoll"));
await sleep(700);
assert(/合计 · \d+/.test($("#diceSum").textContent), "骰子结果求和");
document.querySelector('#modalDice [data-close]').click();

click(document.querySelector('[data-module="note"]'));
setVal($("#noteText"), "买牛奶");
await sleep(600);
assert(window.localStorage.getItem("rhine.note").includes("买牛奶"), "速记自动保存");
document.querySelector('#modalNote [data-close]').click();

click(document.querySelector('[data-module="clock"]'));
assert(/^\d{2}:\d{2}:\d{2}$/.test($("#modalClockTime").textContent), "弹窗时钟渲染");
click($("#stopToggle"));
await sleep(400);
click($("#stopToggle"));
click($("#stopReset"));
assert($("#stopDigits").textContent === "00:00.0", "秒表归零");
document.querySelector('#modalClock [data-close]').click();

click(document.querySelector('[data-module="soon"]'));
assert(Array.from($$(".toast")).some((t) => t.textContent.includes("装配中")), "装配中模块提示正常");

/* ---------- 统计 ---------- */
assert($("#statRuns").textContent === "002", "累计抽取统计：" + $("#statRuns").textContent);
assert($("#statToday").textContent === "02", "今日决策统计：" + $("#statToday").textContent);

console.log("\n=== RESULTS: " + pass + " passed, " + fail + " failed ===");
results.forEach((r) => console.log(r));
if (errors.length) {
  console.log("\n=== RUNTIME ERRORS (" + errors.length + ") ===");
  errors.forEach((e) => console.log(e));
}
dom.window.close();
process.exit(fail || errors.length ? 1 : 0);
