import * as fs from "node:fs";
import * as path from "node:path";

const cwd = process.cwd();
const required = [
  "package.json",
  "src/services/app_server.ts",
  "public/app.html",
  "public/etsy-image-agent.html",
  "public/asset-library.html",
  "api/index.ts",
  "vercel.json",
  "DESIGN.md",
];

if (path.basename(cwd) !== "Etsyauto") {
  throw new Error(`请在 自动化文件夹/Etsyauto 内运行，当前目录：${cwd}`);
}

for (const file of required) {
  if (!fs.existsSync(path.join(cwd, file))) throw new Error(`缺少必要文件：${file}`);
}

console.log("Local verification passed: Etsyauto project structure and new pages are present.");
