import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const entry = path.resolve("dist/cli/etsyauto-launcher.cjs");
const output = path.resolve("dist/win/Etsyauto.exe");

if (!fs.existsSync(entry)) {
  console.error("Missing CLI build output. Run `pnpm build:cli` first.");
  process.exit(1);
}

if (process.platform !== "win32" && process.env.ETSYAUTO_ALLOW_CROSS_PACKAGE !== "1") {
  console.error("Windows .exe packaging must run on Windows so native dependencies such as sharp match the target platform.");
  console.error("Run `pnpm package:win` on a Windows machine or Windows CI. Set ETSYAUTO_ALLOW_CROSS_PACKAGE=1 only for experimental cross-packaging.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(output), { recursive: true });

const pkgCommand = process.platform === "win32" ? "pkg.cmd" : "pkg";
const result = spawnSync(pkgCommand, [
  entry,
  "--targets",
  "node22-win-x64",
  "--output",
  output,
  "--compress",
  "GZip",
  "--no-bytecode",
  "--public",
  "--public-packages",
  "*",
  "--fallback-to-source",
], {
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Packaged Windows launcher: ${path.relative(process.cwd(), output)}`);
