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
    "set -u",
    "",
    "pause_before_exit() {",
    '  if [[ "${ETSYAUTO_NO_PAUSE:-}" == "1" ]]; then',
    "    return",
    "  fi",
    '  echo ""',
    '  read -r "?按回车关闭窗口。"',
    "}",
    "",
    "fail() {",
    '  echo ""',
    '  echo "Mac 自检失败：$1"',
    '  echo ""',
    '  echo "处理建议："',
    '  echo "1. 请完整解压 Etsyauto-Mac.zip，不要只移动单个文件。"',
    '  echo "2. 如果 macOS 提示无法验证开发者，请在 Finder 里右键“启动 Etsyauto.command”，再点“打开”。"',
    '  echo "3. 如果当前电脑是 Intel Mac，请联系打包者提供 Intel 版本；此包只支持 Apple Silicon。"',
    "  pause_before_exit",
    "  exit 1",
    "}",
    "",
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    'cd "$SCRIPT_DIR" || fail "无法进入程序目录。"',
    "",
    'if [[ "$(uname -m)" != "arm64" ]]; then',
    '  fail "当前 Mac 不是 Apple Silicon arm64，不能运行这个交付包。"',
    "fi",
    "",
    'if command -v xattr >/dev/null 2>&1; then',
    '  xattr -dr com.apple.quarantine "$SCRIPT_DIR" 2>/dev/null || true',
    "fi",
    "",
    "REQUIRED_FILES=(",
    '  "Etsyauto"',
    '  "public/etsy-image-agent.html"',
    '  "public/openai-settings.html"',
    '  "node_modules/sharp/lib/sharp.js"',
    '  "node_modules/@img/sharp-darwin-arm64/lib/sharp-darwin-arm64.node"',
    '  "node_modules/@img/sharp-libvips-darwin-arm64/lib"',
    ")",
    "",
    'for required_file in "${REQUIRED_FILES[@]}"; do',
    '  if [[ ! -e "$SCRIPT_DIR/$required_file" ]]; then',
    '    fail "缺少必要文件：$required_file"',
    "  fi",
    "done",
    "",
    'chmod +x "$SCRIPT_DIR/Etsyauto" 2>/dev/null || fail "无法给 Etsyauto 添加执行权限。"',
    "",
    'echo "Etsyauto Mac 自检通过，正在启动网页工作台..."',
    'echo "如果默认端口被占用，程序会自动切换到可用端口。"',
    'echo ""',
    'set +e',
    '"$SCRIPT_DIR/Etsyauto" "$@"',
    "exit_code=$?",
    'set -e',
    'echo ""',
    'echo "Etsyauto 已退出，代码：$exit_code"',
    'if [[ "$exit_code" != "0" ]]; then',
    '  echo "如果上方显示端口或依赖错误，请把完整终端内容发给维护者。"',
    "fi",
    "pause_before_exit",
    "exit $exit_code",
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
    "- 启动脚本会自动做 Mac 自检、修复执行权限、尝试移除下载隔离属性，并在缺文件时给出中文提示。",
    "- 如果默认端口 3456 被占用，程序会自动切换到另一个可用端口，并在终端里打印实际工作台 URL。",
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
