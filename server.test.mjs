/* 后端 API 测试：启动真实 server.js（独立数据目录），逐项验证认证 / 邀请制 / 清单 / 文章 / 评论权限 */
import { spawn, spawnSync } from "node:child_process";
import { rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
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
  try { data = await res.json(); } catch (e) { /* 无 JSON 体 */ }
  return { status: res.status, data };
}

/* 启动服务（预置三个一次性邀请码，其中一个是带连字符的） */
rmSync(DATA_DIR, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(
  DATA_DIR + "/db.json",
  JSON.stringify({
    users: [],
    sheets: [],
    articles: [],
    sessions: [],
    invites: [
      { code: "AAAA1111", usedBy: null, usedAt: null, createdAt: Date.now() },
      { code: "BBBB2222", usedBy: null, usedAt: null, createdAt: Date.now() },
      { code: "DDDD-4444", usedBy: null, usedAt: null, createdAt: Date.now() }
    ],
    comments: []
  })
);
const child = spawn(process.execPath, ["server.js"], {
  cwd: dir,
  env: { ...process.env, PORT, RHINE_DATA: DATA_DIR, RHINE_NO_ENV_FILE: "1", DATABASE_URL: "" },
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

  /* —— 认证与邀请制 —— */
  const noCode = await req("/api/register", { method: "POST", body: { username: "alice", password: "secret123" } });
  assert(noCode.status === 400, "无邀请码注册被拒绝");

  const badCode = await req("/api/register", { method: "POST", body: { username: "alice", password: "secret123", inviteCode: "XXXX9999" } });
  assert(badCode.status === 403, "无效邀请码注册被拒绝");

  const reg = await req("/api/register", { method: "POST", body: { username: "alice", password: "secret123", inviteCode: "aaaa-1111" } });
  assert(reg.status === 200 && reg.data.token && reg.data.username === "alice", "携带有效邀请码注册成功（大小写/连字符不敏感）");
  const aliceToken = reg.data.token;

  const reuse = await req("/api/register", { method: "POST", body: { username: "mallory", password: "secret789", inviteCode: "AAAA1111" } });
  assert(reuse.status === 403, "已使用的邀请码不可再次注册");

  const dup = await req("/api/register", { method: "POST", body: { username: "alice", password: "xxxxxx", inviteCode: "BBBB2222" } });
  assert(dup.status === 409, "重复注册返回 409");

  const dashed = await req("/api/register", { method: "POST", body: { username: "dave", password: "secret777", inviteCode: "dddd4444" } });
  assert(dashed.status === 200 && dashed.data.username === "dave", "带连字符存储的邀请码可用无连字符输入注册");

  const badPw = await req("/api/login", { method: "POST", body: { username: "alice", password: "wrongpw" } });
  assert(badPw.status === 401, "错误密码登录返回 401");

  const login = await req("/api/login", { method: "POST", body: { username: "alice", password: "secret123" } });
  assert(login.status === 200 && login.data.token, "正确密码登录成功");

  const me = await req("/api/me", { token: aliceToken });
  assert(me.status === 200 && me.data.username === "alice", "带 token 查询 me 成功");
  assert(me.data.avatar === null, "默认没有自定义头像");
  const meNone = await req("/api/me");
  assert(meNone.status === 401, "无 token 查询 me 返回 401");

  /* —— 自定义头像 —— */
  const setEmoji = await req("/api/me/avatar", { method: "PUT", token: aliceToken, body: { avatar: "🦊" } });
  assert(setEmoji.status === 200 && setEmoji.data.avatar === "🦊", "设置 emoji 头像成功");
  const meAvatar = await req("/api/me", { token: aliceToken });
  assert(meAvatar.data.avatar === "🦊", "头像已保存到账号");
  const hugeAvatar = await req("/api/me/avatar", { method: "PUT", token: aliceToken, body: { avatar: "data:image/png;base64," + "A".repeat(200000) } });
  assert(hugeAvatar.status === 400, "超大图片头像被拒绝");
  const resetAvatar = await req("/api/me/avatar", { method: "PUT", token: aliceToken, body: { avatar: null } });
  assert(resetAvatar.status === 200 && resetAvatar.data.avatar === null, "恢复默认头像成功");
  const setColor = await req("/api/me/avatar", { method: "PUT", token: aliceToken, body: { avatar: "color:#34c759" } });
  assert(setColor.status === 200 && setColor.data.avatar === "color:#34c759", "设置色块头像成功");

  /* —— 站点设置 / 版本 / 管理员 —— */
  const pubSettings = await req("/api/settings");
  assert(pubSettings.status === 200 && pubSettings.data.siteName && pubSettings.data.version, "公开站点设置可读");
  const versionInfo = await req("/api/version");
  assert(versionInfo.status === 200 && versionInfo.data.version, "版本接口返回版本号");
  assert(Array.isArray(versionInfo.data.changelog) && versionInfo.data.changelog.length > 0, "版本接口返回更新日志");
  assert(pubSettings.data.version === versionInfo.data.version, "站点设置与版本文件一致");
  const meInfo = await req("/api/me", { token: aliceToken });
  assert(meInfo.data.isAdmin === false, "普通用户 isAdmin 为 false");
  const waimai = await req("/api/waimai");
  assert(waimai.status === 200 && Array.isArray(waimai.data.items), "外卖商品接口可读");
  const waimaiPut = await req("/api/waimai", { method: "PUT", token: aliceToken, body: { items: ["测试商品"] } });
  assert(waimaiPut.status === 403, "非管理员不能推送外卖商品");
  const waimaiDel = await req("/api/waimai", { method: "DELETE", token: aliceToken });
  assert(waimaiDel.status === 403, "非管理员不能删除外卖数据");
  const adminUsers = await req("/api/admin/users", { token: aliceToken });
  assert(adminUsers.status === 403, "非管理员访问成员列表被拒");
  const adminSettings = await req("/api/admin/settings", { token: aliceToken });
  assert(adminSettings.status === 403, "非管理员访问设置被拒");

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

  const regBob = await req("/api/register", { method: "POST", body: { username: "bob", password: "secret456", inviteCode: "BBBB-2222" } });
  assert(regBob.status === 200, "第二个邀请码注册 bob 成功");
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

  /* —— 评论（此时 privId 仍是私密） —— */
  const cmtGuest = await req("/api/articles/" + pubId + "/comments");
  assert(cmtGuest.status === 401, "未登录读取评论返回 401");

  const cmtPriv = await req("/api/articles/" + privId + "/comments", { method: "POST", token: bobToken, body: { content: "偷看私密文章的评论" } });
  assert(cmtPriv.status === 403, "他人私密文章不可评论");

  const cmt = await req("/api/articles/" + pubId + "/comments", { method: "POST", token: bobToken, body: { content: "写得真好！" } });
  assert(cmt.status === 200 && cmt.data.comment.username === "bob" && cmt.data.comment.mine === true, "bob 评论公开文章成功");
  const cmtId = cmt.data.comment.id;

  const cmtEmpty = await req("/api/articles/" + pubId + "/comments", { method: "POST", token: bobToken, body: { content: "   " } });
  assert(cmtEmpty.status === 400, "空评论被拒绝");

  const cmtList = await req("/api/articles/" + pubId + "/comments", { token: aliceToken });
  assert(cmtList.status === 200 && cmtList.data.comments.length === 1 && cmtList.data.comments[0].mine === false, "alice 查看评论（标记非本人）");

  const aliceListB = await req("/api/articles", { token: aliceToken });
  const pubInList = aliceListB.data.articles.find((a) => a.id === pubId);
  assert(pubInList && pubInList.commentCount === 1, "文章列表返回评论数");

  const aliceDelCmt = await req("/api/comments/" + cmtId, { method: "DELETE", token: aliceToken });
  assert(aliceDelCmt.status === 403, "不能删除他人的评论");

  const bobDelCmt = await req("/api/comments/" + cmtId, { method: "DELETE", token: bobToken });
  assert(bobDelCmt.status === 200, "bob 删除自己的评论成功");

  const cmtList2 = await req("/api/articles/" + pubId + "/comments", { token: aliceToken });
  assert(cmtList2.data.comments.length === 0, "删除后评论列表为空");

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

  /* —— 圈主 CLI —— */
  const cli = spawnSync(process.execPath, ["server.js", "--invite", "2"], {
    cwd: dir,
    env: { ...process.env, RHINE_DATA: DATA_DIR, RHINE_NO_ENV_FILE: "1", DATABASE_URL: "" },
    stdio: "inherit"
  });
  assert(cli.status === 0, "--invite 命令正常退出");
  const dbAfter = JSON.parse(readFileSync(DATA_DIR + "/db.json", "utf8"));
  assert(dbAfter.invites.length === 5, "生成的邀请码已写入数据库");
  assert(dbAfter.invites.filter((i) => !i.usedBy).length === 2, "剩余未使用邀请码数量正确（新生成 2 个）");

  const cliUsers = spawnSync(process.execPath, ["server.js", "--users"], {
    cwd: dir,
    env: { ...process.env, RHINE_DATA: DATA_DIR, RHINE_NO_ENV_FILE: "1", DATABASE_URL: "" },
    stdio: "inherit"
  });
  assert(cliUsers.status === 0, "--users 命令正常退出");

  /* —— 运行期间生成邀请码：无需重启即可注册（回归测试） —— */
  const dbBefore = JSON.parse(readFileSync(DATA_DIR + "/db.json", "utf8"));
  dbBefore.invites.push({ code: "CCCC3333", usedBy: null, usedAt: null, createdAt: Date.now() });
  writeFileSync(DATA_DIR + "/db.json", JSON.stringify(dbBefore));

  const carol = await req("/api/register", { method: "POST", body: { username: "carol", password: "secret101", inviteCode: "cccc-3333" } });
  assert(carol.status === 200 && carol.data.username === "carol", "服务运行期间新增的邀请码立即可用（无需重启）");

  const dbNow = JSON.parse(readFileSync(DATA_DIR + "/db.json", "utf8"));
  assert(dbNow.invites.some((i) => i.code === "CCCC3333" && i.usedBy), "邀请码使用状态已持久化到磁盘");
  assert(dbNow.invites.filter((i) => !i.usedBy).length === 2, "服务保存时不会丢失 CLI 生成的邀请码");

  /* —— 静态托管 —— */
  const page = await fetch(BASE + "/");
  const html = await page.text();
  assert(page.status === 200 && html.includes("RHEIN TERMINAL"), "静态首页可访问");
  const js = await fetch(BASE + "/app.js");
  assert(js.status === 200 && (await js.text()).includes("rhine.auth"), "app.js 可访问");
  const notFound = await fetch(BASE + "/不存在");
  assert(notFound.status === 403, "非白名单路径返回 403");
  const envLeak = await fetch(BASE + "/.env.local");
  assert(envLeak.status === 403, ".env.local 不可访问");
  const toolsLeak = await fetch(BASE + "/tools/taobao_scraper.py");
  assert(toolsLeak.status === 403, "tools 目录不可访问");
  const pkgLeak = await fetch(BASE + "/package.json");
  assert(pkgLeak.status === 403, "package.json 不可访问");
  const versionRes = await fetch(BASE + "/version.json");
  assert(versionRes.status === 200, "version.json 可访问");
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
