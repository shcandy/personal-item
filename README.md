# RHEIN TERMINAL · 模块工具台

苹果简约风的模块化网页工具台：浅灰底 `#f5f5f7`、毛玻璃卡片、系统字体、胶囊按钮。
前端纯原生 HTML / CSS / JavaScript；后端为零依赖 Node 服务（`server.js`），负责账号、云端清单与文章广场。

## 启动

```powershell
cd C:\deepseekharness\rhine-terminal
node server.js
```

打开 <http://localhost:8000>。

- 端口：`$env:PORT=9000; node server.js`
- 数据目录：默认 `data/db.json`，可用 `$env:RHINE_DATA='D:\rhine-data'; node server.js` 更换
- 局域网分享：`http://<本机IP>:8000`（同一网络下访问，Windows 防火墙首次会询问）

> 仅双击 `index.html` 也能用：此时进入**本地模式**（顶栏显示"本地模式"），
> 预设抽取、计时、骰子、速记、秒表照常可用；登录、云端清单与文章广场需要 `node server.js`。

## 模块一览

| 编号 | 模块 | 状态 |
| --- | --- | --- |
| M-01 | 随机选择器 | ✅ 就绪 |
| M-02 | 专注计时（15/25/45 分钟） | ✅ 就绪 |
| M-03 | 掷骰子（1–3 枚） | ✅ 就绪 |
| M-04 | 速记板（本机自动保存） | ✅ 就绪 |
| M-05 | 时钟与秒表 | ✅ 就绪 |
| M-06 | 文章广场（账号体系） | ✅ 就绪 |
| M-07 / M-08 | 翻译终端 / 更多模块 | 🔧 装配中 |

## 随机选择器（M-01）

三个来源面板：

- **内置预设**：25 种食物，分类筛选，全选 / 清空选择（只影响选中状态）
- **我的清单**（登录后）：清单随账号存储在服务器，支持新建 / 重命名 / 删除（二次确认）、逐项增删，换设备同步
- **临时导入**：拖放或选择文件（`.csv` / `.txt` / `.json`）或直接粘贴，自动识别表头
  - **导入名单不可一键清空**，只能逐项移除；可一键「存为我的清单」
  - 「清空本次记录」仅清空抽取历史，不影响任何名单

抽取选项：数量（1–10）、去重开关、抽取后消耗开关；滚轮动画、历史（12 条）、次数统计。

## 账号与文章广场（M-06）

- 注册 / 登录：密码使用 scrypt 加盐哈希存储，登录颁发 30 天 token
- **文章广场**：舒适阅读窗口（衬线字体、宽行距）；每篇文章可设为**公开**或**私密**
  - 未登录用户：所有文章均为私密，广场显示锁定引导
  - 登录用户：可看到全部公开文章 + 自己的私密文章；只能编辑 / 删除自己的文章

## 测试

```powershell
node test.mjs          # 前端 72 项断言（jsdom + 内存 fetch 桩，依赖在 _tools/）
node server.test.mjs   # 后端 38 项断言（启动真实服务，独立数据目录，自动清理）
```

## 部署与分享

- **局域网**：`node server.js` 后把 `http://<本机IP>:8000` 发给同一网络的人
- **公网**：需要能运行 Node 的托管（Render / Railway / Glitch 等，部署命令 `node server.js`，数据目录挂持久盘）
- GitHub Pages 只能托管静态文件，跑不了登录与文章广场（前端会退化为本地模式），因此完整功能需要上面的 Node 托管
- 数据全部在 `data/db.json`，备份它即可迁移全部账号、清单与文章

### 一键更新静态前端（GitHub Pages + 二维码）

仓库克隆到 `C:\deepseekharness\personal-item` 后，双击 **`C:\deepseekharness\一键更新.bat`**：

1. 把本目录最新的 `index.html / styles.css / app.js` 复制进仓库
2. 自动检查 git 提交身份（缺失时补 `shcandy <shcandy@users.noreply.github.com>`）
3. `git add → commit → push` 一气呵成（首次推送需在弹出的浏览器窗口点「允许」授权）
4. 重新生成网站调用二维码 `C:\deepseekharness\RHEIN-访问二维码.png` 并自动打开
5. 更新日志写入 `C:\deepseekharness\最后更新.txt`

推送后 GitHub Pages 约 1–3 分钟生效，浏览器请 Ctrl+F5 强刷；Pages 开关只需在仓库 Settings → Pages 开启一次。
> 本脚本只同步静态前端；`server.js` 不推送到 GitHub Pages（那里跑不了 Node）。

## API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/register` `/api/login` `/api/logout` | 账号 |
| GET | `/api/me` | 当前用户 |
| GET/POST | `/api/sheets` | 清单列表 / 新建 |
| GET/PUT/DELETE | `/api/sheets/:id` | 清单读取 / 更新 / 删除（仅本人） |
| GET/POST | `/api/articles` | 文章列表（公开+本人）/ 发布 |
| GET/PUT/DELETE | `/api/articles/:id` | 阅读 / 编辑 / 删除（编辑删除仅本人） |
