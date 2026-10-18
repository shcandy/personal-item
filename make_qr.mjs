/* 生成网站访问二维码（PNG 供手机扫码 / 打印，SVG 备用）
   可选参数：输出目录（默认本目录） */
import QRCode from "./_tools/node_modules/qrcode/lib/index.js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const url = "https://shcandy.github.io/personal-item/";
const dir = fileURLToPath(new URL(".", import.meta.url));
const outDir = process.argv[2] ? resolve(process.argv[2]) : dir;

await QRCode.toFile(
  resolve(outDir, "RHEIN-访问二维码.png"),
  url,
  { type: "png", width: 640, margin: 2, color: { dark: "#22272b", light: "#f1eee4" } }
);
const svg = await QRCode.toString(url, {
  type: "svg",
  width: 640,
  margin: 2,
  color: { dark: "#22272b", light: "#f1eee4" }
});
writeFileSync(resolve(outDir, "RHEIN-访问二维码.svg"), svg);
console.log("QR 已生成到: " + outDir);
