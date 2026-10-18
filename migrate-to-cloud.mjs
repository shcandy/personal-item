/* ============================================================
   把本地 data/db.json 迁移到云端 PostgreSQL（Neon 等）
   用法：
     $env:DATABASE_URL = "postgresql://..."
     npm install
     node migrate-to-cloud.mjs
   ============================================================ */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("请先设置 DATABASE_URL 环境变量，例如：");
  console.error('  $env:DATABASE_URL = "postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"');
  process.exit(1);
}

const dir = fileURLToPath(new URL(".", import.meta.url));
const dbPath = dir + "data/db.json";
let data;
try {
  data = JSON.parse(readFileSync(dbPath, "utf8"));
} catch (e) {
  console.error("读取 data/db.json 失败：" + e.message);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
await pool.query(`create table if not exists app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
)`);
await pool.query(
  `insert into app_state (id, data, updated_at) values ($1, $2::jsonb, now())
   on conflict (id) do update set data = excluded.data, updated_at = now()`,
  ["rhein-terminal", JSON.stringify(data)]
);
console.log(
  `迁移完成：${(data.users || []).length} 个用户 / ${(data.articles || []).length} 篇文章 / ` +
  `${(data.comments || []).length} 条评论 / ${(data.sheets || []).length} 个清单`
);
await pool.end();
