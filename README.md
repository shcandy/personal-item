# RHEIN TERMINAL · 模块工具台

> 一个苹果风格的模块化个人工具台。安静、克制、随手可用。

![version](https://img.shields.io/badge/version-2.3.0-0071e3)
![node](https://img.shields.io/badge/node-%3E%3D18-34c759)
![frontend](https://img.shields.io/badge/frontend-vanilla%20HTML%2FCSS%2FJS-f5a623)
![backend](https://img.shields.io/badge/backend-zero--dependency%20Node-8b5cf6)

**在线体验** · <https://rhine-terminal.onrender.com>
（Render 免费实例，冷启动约 1 分钟）

**静态预览** · <https://shcandy.github.io/personal-item>
（GitHub Pages 只托管界面，登录 / 注册 / 评论请用上面的正式地址）

---

## 这是什么

RHEIN TERMINAL 把日常会用的小工具放进同一张卡片网格里：随机吃什么、专注计时、掷骰子、速记、时钟秒表，还有一个只对受邀成员开放的文章广场。

- **设计**：浅灰底 `#f5f5f7`、毛玻璃卡片、系统字体、胶囊按钮；深浅色主题、强调色、壁纸都可换。
- **技术**：前端纯原生 HTML / CSS / JavaScript；后端是一个零依赖的 Node HTTP 服务（`server.js`），本地跑文件、云端跑 PostgreSQL 都行。
- **数据**：默认存 `data/db.json`；配置 `DATABASE_URL` 后改用 Postgres（Neon），账号、清单、文章全部持久化。

## 功能一览

### 六个模块

| 编号 | 模块 | 能做什么 |
| --- | --- | --- |
| M-01 | 随机选择器 | 25 种食物预设 + 云端清单 + CSV / TXT / JSON 导入；数量、去重、消耗、历史统计 |
| M-02 | 专注计时 | 15 / 25 / 45 分钟，进度环与今日完成统计 |
| M-03 | 掷骰子 | 1–3 枚，滚动动画与点数统计 |
| M-04 | 速记板 | 本机自动保存，实时预览 |
| M-05 | 时钟与秒表 | 时钟、日期、秒表、今日已过百分比 |
| M-06 | 文章广场 | 账号体系、公开 / 私密文章、评论区、10 秒静默同步 |
| M-07 / M-08 | 翻译终端 / 更多 | 装配中 |

模块卡片支持**调整布局**：点「调整布局」后可拖动排序、切换方形 / 长方形、隐藏任意模块，布局保存在本机浏览器。

### 账号与邀请制

站点**不开放公开注册**。注册必须携带圈主生成的一次性邀请码：

- 邀请码 8 位，一个码只能注册一个账号，注册后立即失效
- 密码使用 **scrypt + 每用户盐** 存储，比较时用 `crypto.timingSafeEqual`
- 登录颁发 **30 天** 会话 token
- 所有编辑 / 删除都在服务端校验归属：**只能操作自己的清单、文章和评论**

圈主命令（本地或带 `DATABASE_URL` 的云端）：

```bash
node server.js --invite 5          # 生成 5 个一次性邀请码
node server.js --users             # 查看用户与剩余邀请码
node server.js --make-admin 名字    # 把某个账号设为管理员
```

### 文章广场

- 舒适阅读窗口：衬线字体、宽行距、窄栏宽
- 每篇文章可设为 **圈子可见** 或 **仅自己可见**
- 未登录：所有文章都私密，广场显示锁定引导
- 已登录：能看到全部圈子可见文章 + 自己的私密文章
- 评论区：登录后可评论，只能删除自己的评论
- 广场打开期间每 10 秒静默同步一次列表

### 个性化

顶栏齿轮打开「个性化设置」，偏好保存在本机浏览器：

- **主题**：跟随系统 / 浅色 / 深色（顶栏图标可一键切换）
- **强调色**：蓝 / 绿 / 紫 / 橙 / 粉
- **阅读字体**：衬线 / 无衬线
- **界面动效**：标准 / 减少
- **壁纸**：4 种渐变预设 + 上传图片（只替换背景，毛玻璃模块保持不变）
- **头像**：8 个默认色块，或上传图片——圆形取景框、拖动 / 缩放、256×256 高清输出，随账号同步

右下角有**版本角标**（如 `v2.3.0`），点击可看本次更新说明；版本变化时会自动提示一次。

### 管理员模式（仅圈主）

- 顶栏盾牌图标切换管理员模式，管理面板只对管理员显示
- **成员**：所有受邀成员的姓名、头像、注册日期
- **界面文字**：站点名、主标题、副标题、页脚、公告，保存后即时生效
- **开发日志**：版本号与更新说明，会同步到首页版本角标

### 手机端

全屏弹窗、单列卡片、安全区留白、触控友好的按钮尺寸，480px 以下还有更紧凑的顶栏与排版。

## 快速开始

```bash
git clone https://github.com/shcandy/personal-item.git
cd personal-item
node server.js
```

打开 <http://localhost:8000>。

常用环境变量：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `PORT` | 监听端口 | `8000` |
| `RHINE_DATA` | 数据目录 | `./data` |
| `DATABASE_URL` | Postgres 连接串；设置后改用数据库 | 空（文件模式） |
| `RHINE_NO_ENV_FILE` | 设为 `1` 时不读取 `.env` / `.env.local` | 空 |

> 只双击 `index.html` 也能用：此时是**本地模式**，预设抽取、计时、骰子、速记、秒表照常可用；登录、云端清单与文章广场需要 `node server.js`。

## 部署（Render + Neon）

1. **建数据库**：在 [Neon](https://neon.tech) 创建免费项目，复制连接串
2. **推代码**：把本仓库推到 GitHub
3. **部署**：在 [Render](https://render.com) 新建 Blueprint，选中仓库；`render.yaml` 会自动创建 Web 服务，把 `DATABASE_URL` 填成第 1 步的连接串
4. 状态变 **Live** 后即可访问，得到形如 `https://rhine-terminal.onrender.com` 的固定地址
5. **迁移本地数据**（可选）：
   ```bash
   DATABASE_URL="连接串" node migrate-to-cloud.mjs
   ```
6. **生成二维码**：
   ```bash
   node make_qr.mjs . https://你的地址 RHEIN-公网二维码
   ```

> Render 免费实例 15 分钟无访问会休眠，首次打开约需 1 分钟唤醒；数据在 Neon，不会丢。

## API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/register` | 注册（需 `inviteCode`） |
| POST | `/api/login` | 登录，返回 30 天 token |
| POST | `/api/logout` | 登出 |
| GET | `/api/me` | 当前用户（含头像、管理员标记） |
| PUT | `/api/me/avatar` | 设置头像（色块或图片） |
| GET | `/api/settings` | 站点公开设置（标题、公告、版本） |
| GET | `/api/admin/users` | 成员列表（仅管理员） |
| GET / PUT | `/api/admin/settings` | 站点文字与开发日志（仅管理员） |
| GET / POST | `/api/sheets` | 清单列表 / 新建 |
| GET / PUT / DELETE | `/api/sheets/:id` | 清单读取 / 更新 / 删除（仅本人） |
| GET / POST | `/api/articles` | 文章列表（圈子可见 + 本人私密）/ 发布 |
| GET / PUT / DELETE | `/api/articles/:id` | 阅读 / 编辑 / 删除（编辑删除仅本人） |
| GET / POST | `/api/articles/:id/comments` | 评论列表 / 发表 |
| DELETE | `/api/comments/:id` | 删除自己的评论 |

## 项目结构

```text
personal-item/
├── index.html          # 单页界面（模块网格 + 各种弹窗）
├── styles.css          # 设计系统、深色主题、响应式
├── app.js              # 前端逻辑：模块、账号、广场、管理、个性化
├── server.js           # 零依赖 Node 后端（本地文件 / Postgres）
├── render.yaml         # Render Blueprint
├── migrate-to-cloud.mjs# 本地数据迁移到 Postgres
├── make_qr.mjs         # 生成访问二维码
├── test.mjs            # 前端测试（jsdom）
├── server.test.mjs     # 后端测试（真实服务 + 独立数据目录）
└── data/db.json        # 本地数据（默认，已被 gitignore）
```

## 测试与构建

```bash
npm test          # 前端 124 项 + 后端 69 项
npm run build     # 语法检查（server.js / app.js / 脚本）
```

## 安全说明

- 邀请制注册，未登录时文章全部私密
- 密码 scrypt 加盐哈希，token 30 天有效
- 清单、文章、评论都做服务端归属校验
- 头像上传限制格式（PNG / JPEG / WebP / GIF）与体积（< 90KB）
- 公网部署时请把 `DATABASE_URL` 放在环境变量里，不要提交到仓库

## 路线图

- M-07 翻译终端、M-08 更多模块
- 文章 Markdown 增强与全文搜索
- 更细的成员权限与操作审计

---

个人项目 · 供自己与受邀的小圈子使用
