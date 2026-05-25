import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

const { ZipArchive } = createRequire(import.meta.url)("archiver");

const projectRoot = process.cwd();
const packageName = "Etsyauto-Windows";
const deliveryRoot = path.join(projectRoot, "dist", "delivery");
const packageDir = path.join(deliveryRoot, packageName);
const zipPath = path.join(deliveryRoot, `${packageName}.zip`);
const exePath = path.join(projectRoot, "dist", "win", "Etsyauto.exe");

const copyEntries = [
  { from: "dist/win/Etsyauto.exe", to: "Etsyauto.exe" },
  { from: "public", to: "public" },
  { from: "node_modules/sharp", to: "node_modules/sharp" },
  { from: "node_modules/@img/sharp-win32-x64", to: "node_modules/@img/sharp-win32-x64" },
  { from: "node_modules/@img/sharp-libvips-win32-x64", to: "node_modules/@img/sharp-libvips-win32-x64" },
];

const requiredDeliveryFiles = [
  "Etsyauto.exe",
  "public/etsy-image-agent.html",
  "node_modules/sharp/lib/sharp.js",
  "node_modules/detect-libc/package.json",
  "node_modules/semver/package.json",
  "node_modules/@img/colour/package.json",
  "node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node",
  "node_modules/@img/sharp-libvips-win32-x64/lib/libvips-42.dll",
];

function assertExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${path.relative(projectRoot, filePath)}`);
  }
}

function copyRuntimeEntry(entry) {
  const source = path.join(projectRoot, entry.from);
  const target = path.join(packageDir, entry.to);
  assertExists(source, entry.from);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    dereference: true,
    errorOnExist: false,
    force: true,
    recursive: true,
  });
}

function findSharpDependencyPackage(packageName) {
  const sharpRoot = path.join(projectRoot, "node_modules", "sharp");
  assertExists(sharpRoot, "sharp package");
  const requireFromSharp = createRequire(path.join(fs.realpathSync(sharpRoot), "package.json"));
  return path.dirname(requireFromSharp.resolve(`${packageName}/package.json`));
}

function copySharpDependencyPackage(packageName) {
  const source = findSharpDependencyPackage(packageName);
  const target = path.join(packageDir, "node_modules", ...packageName.split("/"));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    dereference: true,
    errorOnExist: false,
    force: true,
    recursive: true,
  });
}

function writeReadme() {
  const readme = [
    "Etsyauto Windows Launcher",
    "",
    "Usage:",
    "1. Double-click Etsyauto.exe.",
    "2. Keep the terminal window open while using the web workbench.",
    "3. The browser should open automatically at http://127.0.0.1:3456/etsy-image-agent.",
    "",
    "Important:",
    "- Do not move Etsyauto.exe out of this folder by itself.",
    "- The bundled node_modules folder contains the Windows sharp runtime required for image processing.",
    "- If the browser does not open automatically, copy the workbench URL printed in the terminal.",
  ].join("\r\n");
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
}

assertExists(exePath, "Windows launcher exe");
fs.rmSync(packageDir, { force: true, recursive: true });
fs.mkdirSync(packageDir, { recursive: true });
for (const entry of copyEntries) copyRuntimeEntry(entry);
copySharpDependencyPackage("detect-libc");
copySharpDependencyPackage("semver");
copySharpDependencyPackage("@img/colour");
writeReadme();
assertDeliveryPackage();
await zipDeliveryFolder();

const sizeBytes = fs.statSync(zipPath).size;
console.log(`Created ${path.relative(projectRoot, zipPath)}`);
console.log(`Delivery size ${(sizeBytes / 1024 / 1024).toFixed(2)} MiB`);
