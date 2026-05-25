import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const entry = path.resolve("dist/cli/etsyauto-launcher.cjs");
const output = path.resolve("dist/mac-arm64/Etsyauto");

if (!fs.existsSync(entry)) {
  console.error("Missing CLI build output. Run `npm run build:cli` or `pnpm build:cli` first.");
  process.exit(1);
}

if (process.platform !== "darwin" || process.arch !== "arm64") {
  console.error("Mac packaging currently targets Apple Silicon and must run on darwin-arm64 so native dependencies such as sharp match the target platform.");
  console.error("Run `npm run package:mac` or `pnpm package:mac` on an Apple Silicon Mac.");
  process.exit(1);
}

fs.mkdirSync(path.dirname(output), { recursive: true });

const result = spawnSync("pkg", [
  entry,
  "--targets",
  "node22-macos-arm64",
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
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

fs.chmodSync(output, 0o755);
console.log(`Packaged Mac launcher: ${path.relative(process.cwd(), output)}`);
