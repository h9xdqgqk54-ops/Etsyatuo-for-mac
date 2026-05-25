import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

const { ZipArchive } = createRequire(import.meta.url)("archiver");

const projectRoot = process.cwd();
const packageName = "Etsyauto-Mac";
const deliveryRoot = path.join(projectRoot, "dist", "delivery");
const packageDir = path.join(deliveryRoot, packageName);
const zipPath = path.join(deliveryRoot, `${packageName}.zip`);
const launcherPath = path.join(projectRoot, "dist", "mac-arm64", "Etsyauto");

const requiredDeliveryFiles = [
  "Etsyauto",
  "启动 Etsyauto.command",
  "public/etsy-image-agent.html",
  "node_modules/sharp/lib/sharp.js",
  "node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node",
];

function assertExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${path.relative(projectRoot, filePath)}`);
  }
}

function copyPath(source, target) {
  assertExists(source, source);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    dereference: true,
    errorOnExist: false,
    force: true,
    recursive: true,
  });
}

function findSharpSidecarPackage(packageName) {
  const rootCandidate = path.join(projectRoot, "node_modules", "@img", packageName);
  if (fs.existsSync(rootCandidate)) return rootCandidate;

  const sharpRoot = path.join(projectRoot, "node_modules", "sharp");
  if (fs.existsSync(sharpRoot)) {
    const realSharpRoot = fs.realpathSync(sharpRoot);
    const siblingCandidate = path.join(path.dirname(realSharpRoot), "@img", packageName);
    if (fs.existsSync(siblingCandidate)) return siblingCandidate;
  }

  const pnpmCandidate = path.join(projectRoot, "node_modules", ".pnpm", "node_modules", "@img", packageName);
  if (fs.existsSync(pnpmCandidate)) return pnpmCandidate;

  throw new Error(`Missing Mac sharp sidecar package: @img/${packageName}`);
}

function copyRuntimeEntries() {
  copyPath(launcherPath, path.join(packageDir, "Etsyauto"));
  copyPath(path.join(projectRoot, "public"), path.join(packageDir, "public"));
  copyPath(path.join(projectRoot, "node_modules", "sharp"), path.join(packageDir, "node_modules", "sharp"));
  copyPath(findSharpSidecarPackage("sharp-darwin-arm64"), path.join(packageDir, "node_modules", "@img", "sharp-darwin-arm64"));
  copyPath(findSharpSidecarPackage("sharp-libvips-darwin-arm64"), path.join(packageDir, "node_modules", "@img", "sharp-libvips-darwin-arm64"));
}

function writeCommandLauncher() {
  const command = [
    "#!/bin/zsh",
    "set -e",
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    'cd "$SCRIPT_DIR"',
    'chmod +x "$SCRIPT_DIR/Etsyauto" 2>/dev/null || true',
    'exec "$SCRIPT_DIR/Etsyauto" "$@"',
    "",
  ].join("\n");
  const commandPath = path.join(packageDir, "启动 Etsyauto.command");
  fs.writeFileSync(commandPath, command, "utf8");
  fs.chmodSync(commandPath, 0o755);
}

function writeReadme() {
  const readme = [
    "Etsyauto Mac Launcher",
    "",
    "适用范围：Apple Silicon Mac（M1/M2/M3/M4）。",
    "",
    "使用方法：",
    "1. 解压 Etsyauto-Mac.zip。",
    "2. 双击“启动 Etsyauto.command”。",
    "3. 保持打开的终端窗口不要关闭，浏览器会自动进入 Etsyauto 图片 Agent 工作台。",
    "4. 在网页左侧选择图片输入/输出文件夹，在 Provider 设置里填写自己的 GPT5.5 和 OpenAI Key。",
    "",
    "重要说明：",
    "- 不要把 Etsyauto 可执行文件单独拖出去运行，它需要同目录下的 public 和 node_modules。",
    "- API Key 没有打包进程序；请让每个使用者填写自己的 Key。",
    "- 如果 macOS 首次提示无法验证开发者，请在 Finder 里右键“启动 Etsyauto.command”，选择“打开”。",
    "- 关闭终端窗口即可停止本地服务。",
  ].join("\n");
  fs.writeFileSync(path.join(packageDir, "README.txt"), readme, "utf8");
}

async function zipDeliveryFolder() {
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const stream = fs.createWriteStream(zipPath);
  const done = new Promise((resolve, reject) => {
    stream.on("close", resolve);
    stream.on("error", reject);
    archive.on("error", reject);
  });

  archive.pipe(stream);
  archive.directory(packageDir, packageName);
  await archive.finalize();
  await done;
}

function assertDeliveryPackage() {
  for (const file of requiredDeliveryFiles) {
    assertExists(path.join(packageDir, file), file);
  }

  const libvipsDir = path.join(packageDir, "node_modules", "@img", "sharp-libvips-darwin-arm64", "lib");
  const libvipsFile = fs.readdirSync(libvipsDir).find((file) => file.startsWith("libvips-cpp") && file.endsWith(".dylib"));
  if (!libvipsFile) {
    throw new Error("Missing libvips-cpp dylib in Mac delivery package");
  }
}

assertExists(launcherPath, "Mac launcher executable");
fs.rmSync(packageDir, { force: true, recursive: true });
fs.mkdirSync(packageDir, { recursive: true });
copyRuntimeEntries();
writeCommandLauncher();
writeReadme();
assertDeliveryPackage();
await zipDeliveryFolder();

const sizeBytes = fs.statSync(zipPath).size;
console.log(`Created ${path.relative(projectRoot, zipPath)}`);
console.log(`Delivery size ${(sizeBytes / 1024 / 1024).toFixed(2)} MiB`);
