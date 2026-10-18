/* 后端 API 测试：启动真实 server.js（独立数据目录），逐项验证认证 / 清单 / 文章权限 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const PORT = "8731";
const BASE = "http://127.0.0.1:" + PORT;
const DATA_DIR = dir + "data-test";

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("PASS  " + msg); }
  else { fail++; console.log("FAIL  " + msg); }
}

async function req(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* 无 JSON */ }
  return { status: res.status, data };
}

/* 启动服务 */
rmSync(DATA_DIR, { recursive: true, force: true });
const child = spawn(process.execPath, ["server.js"], {
  cwd: dir,
  env: { ...process.env, PORT, RHINE_DATA: DATA_DIR },
  stdio: "inherit"
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ready = false;
for (let i = 0; i < 50; i++) {
  try {
    const r = await fetch(BASE + "/api/health");
    if (r.ok) { ready = true; break; }
  } catch (e) { /* 未就绪 */ }
  await sleep(100);
}
assert(ready, "服务器启动并响应 /api/health");
if (!ready) {
  child.kill();
  process.exit(1);
}

try {
  /* —— 健康检查 —— */
  const h = await req("/api/health");
  assert(h.status === 200 && h.data.ok === true, "健康检查返回 ok");

  /* —— 认证 —— */
  const reg = await req("/api/register", { method: "POST", body: { username: "alice", password: "secret123" } });
  assert(reg.status === 200 && reg.data.token && reg.data.username === "alice", "注册成功并返回 token");
  const aliceToken = reg.data.token;

  const dup = await req("/api/register", { method: "POST", body: { username: "alice", password: "xxxxxx" } });
  assert(dup.status === 409, "重复注册返回 409");

  const badPw = await req("/api/login", { method: "POST", body: { username: "alice", password: "wrongpw" } });
  assert(badPw.status === 401, "错误密码登录返回 401");

  const login = await req("/api/login", { method: "POST", body: { username: "alice", password: "secret123" } });
  assert(login.status === 200 && login.data.token, "正确密码登录成功");

  const me = await req("/api/me", { token: aliceToken });
  assert(me.status === 200 && me.data.username === "alice", "带 token 查询 me 成功");
  const meNone = await req("/api/me");
  assert(meNone.status === 401, "无 token 查询 me 返回 401");

  /* —— 云端清单 —— */
  const mk = await req("/api/sheets", { method: "POST", token: aliceToken, body: { name: "午餐候选", items: ["番茄牛腩饭", "麻辣香锅", "豚骨拉面"] } });
  assert(mk.status === 200 && mk.data.sheet.count === 3, "创建清单（3 项）成功");
  const sheetId = mk.data.sheet.id;

  const badSheet = await req("/api/sheets", { method: "POST", token: aliceToken, body: { name: "", items: [] } });
  assert(badSheet.status === 400, "空名称创建清单被拒绝");

  const list = await req("/api/sheets", { token: aliceToken });
  assert(list.status === 200 && list.data.sheets.length === 1, "清单列表包含 1 个清单");

  const getOne = await req("/api/sheets/" + sheetId, { token: aliceToken });
  assert(getOne.status === 200 && getOne.data.items.length === 3, "按 id 读取清单内容");

  const put = await req("/api/sheets/" + sheetId, { method: "PUT", token: aliceToken, body: { name: "午餐候选V2", items: ["番茄牛腩饭", "麻辣香锅"] } });
  assert(put.status === 200 && put.data.sheet.name === "午餐候选V2" && put.data.items.length === 2, "更新清单名称与内容");

  const listGuest = await req("/api/sheets");
  assert(listGuest.status === 401, "未登录访问清单返回 401");

  /* bob 无法访问 alice 的清单 */
  const regBob = await req("/api/register", { method: "POST", body: { username: "bob", password: "secret456" } });
  const bobToken = regBob.data.token;
  const foreign = await req("/api/sheets/" + sheetId, { token: bobToken });
  assert(foreign.status === 404, "他人清单对 bob 返回 404（不泄露存在性）");
  const foreignPut = await req("/api/sheets/" + sheetId, { method: "PUT", token: bobToken, body: { name: "hack" } });
  assert(foreignPut.status === 404, "他人清单不可修改");

  /* —— 文章广场 —— */
  const articlesGuest = await req("/api/articles");
  assert(articlesGuest.status === 401, "未登录读取文章列表返回 401（全部私密）");

  const pub = await req("/api/articles", { method: "POST", token: aliceToken, body: { title: "公开文章", content: "大家好，这是公开内容。", isPublic: true } });
  assert(pub.status === 200 && pub.data.article.isPublic === true, "发布公开文章成功");
  const pubId = pub.data.article.id;

  const priv = await req("/api/articles", { method: "POST", token: aliceToken, body: { title: "私密文章", content: "只给我自己看的。", isPublic: false } });
  assert(priv.status === 200 && priv.data.article.isPublic === false, "发布私密文章成功");
  const privId = priv.data.article.id;

  const badArt = await req("/api/articles", { method: "POST", token: aliceToken, body: { title: "", content: "x" } });
  assert(badArt.status === 400, "空标题文章被拒绝");

  const aliceList = await req("/api/articles", { token: aliceToken });
  assert(aliceList.status === 200 && aliceList.data.articles.length === 2, "作者本人看到 2 篇文章（含私密）");

  const bobList = await req("/api/articles", { token: bobToken });
  assert(bobList.status === 200 && bobList.data.articles.length === 1, "bob 只看到 1 篇公开文章");
  assert(bobList.data.articles[0].title === "公开文章", "bob 看到的是公开文章");
  assert(bobList.data.articles[0].excerpt && !bobList.data.articles[0].content, "列表接口不泄露全文");

  const bobReadPriv = await req("/api/articles/" + privId, { token: bobToken });
  assert(bobReadPriv.status === 403, "bob 读取他人私密文章返回 403");

  const bobReadPub = await req("/api/articles/" + pubId, { token: bobToken });
  assert(bobReadPub.status === 200 && bobReadPub.data.article.content.includes("公开"), "bob 可读取公开文章全文");

  const bobEdit = await req("/api/articles/" + pubId, { method: "PUT", token: bobToken, body: { title: "hack" } });
  assert(bobEdit.status === 403, "bob 不能编辑他人文章");

  const bobDelete = await req("/api/articles/" + pubId, { method: "DELETE", token: bobToken });
  assert(bobDelete.status === 403, "bob 不能删除他人文章");

  const toPublic = await req("/api/articles/" + privId, { method: "PUT", token: aliceToken, body: { isPublic: true } });
  assert(toPublic.status === 200 && toPublic.data.article.isPublic === true, "作者可将私密文章改为公开");

  const bobList2 = await req("/api/articles", { token: bobToken });
  assert(bobList2.data.articles.length === 2, "公开后 bob 可看到 2 篇");

  const del = await req("/api/articles/" + pubId, { method: "DELETE", token: aliceToken });
  assert(del.status === 200, "作者删除文章成功");
  const aliceList2 = await req("/api/articles", { token: aliceToken });
  assert(aliceList2.data.articles.length === 1, "删除后列表剩 1 篇");

  /* —— 退出登录 —— */
  const out = await req("/api/logout", { method: "POST", token: aliceToken });
  assert(out.status === 200, "退出登录成功");
  const meAfter = await req("/api/me", { token: aliceToken });
  assert(meAfter.status === 401, "退出后原 token 失效");

  /* —— 静态托管 —— */
  const page = await fetch(BASE + "/");
  const html = await page.text();
  assert(page.status === 200 && html.includes("RHEIN TERMINAL"), "静态首页可访问");
  const js = await fetch(BASE + "/app.js");
  assert(js.status === 200 && (await js.text()).includes("rhine.auth"), "app.js 可访问");
  const notFound = await fetch(BASE + "/不存在");
  assert(notFound.status === 404, "未知路径返回 404");
  const traversal = await fetch(BASE + "/../server.js");
  assert(traversal.status === 404 || traversal.status === 403, "路径穿越被拒绝");
} catch (e) {
  console.log("EXCEPTION: " + (e && e.stack || e));
  fail++;
} finally {
  child.kill();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log("\n=== SERVER RESULTS: " + pass + " passed, " + fail + " failed ===");
process.exit(fail ? 1 : 0);
