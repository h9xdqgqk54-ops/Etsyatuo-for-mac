import { ZipArchive } from "archiver";
import * as fs from "node:fs";
import * as path from "node:path";

const projectRoot = process.cwd();
const packageJsonPath = path.join(projectRoot, "package.json");
const outputDir = path.join(projectRoot, "dist");
const outputName = "etsyauto-source-ready.zip";
const outputPath = path.join(outputDir, outputName);
const zipRoot = "etsyauto-source-ready";

const requiredFiles = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  ".env.example",
  "README.md",
  "SOURCE_PACKAGE_README.md",
  "src/services/app_server.ts",
  "api/index.ts",
  "public/etsy-image-agent.html",
  "public/etsy-image-agent.css",
  "public/etsy-image-agent.js",
  "public/openai-settings.html",
  "public/openai-settings.css",
  "public/openai-settings.js",
  "vercel.json",
];

const excludedDirectoryNames = new Set([
  ".git",
  ".claude",
  ".vercel",
  ".vite",
  "build",
  "coverage",
  "data",
  "dist",
  "node_modules",
  "output",
  "storage",
  "user_data",
]);

const excludedFileNames = new Set([".DS_Store", "Thumbs.db", "etsy_results.csv"]);

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function isEnvFile(relativePath) {
  const basename = path.posix.basename(relativePath);
  return basename === ".env" || basename.startsWith(".env.");
}

function isExcluded(relativePath, stats) {
  const posixPath = toPosix(relativePath);
  const segments = posixPath.split("/");
  const basename = segments.at(-1) ?? "";

  if (posixPath === ".env.example") return false;
  if (isEnvFile(posixPath)) return true;
  if (excludedFileNames.has(basename)) return true;
  if (basename.endsWith(".log")) return true;
  if (segments.some((segment) => excludedDirectoryNames.has(segment))) return true;
  if (stats.isDirectory() && excludedDirectoryNames.has(basename)) return true;

  return false;
}

function walk(dir, prefix = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = prefix ? path.join(prefix, entry.name) : entry.name;
    const stats = fs.statSync(absolutePath);

    if (isExcluded(relativePath, stats)) continue;

    if (entry.isDirectory()) {
      files.push(...walk(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push(toPosix(relativePath));
    }
  }

  return files;
}

function assertProjectRoot() {
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found in ${projectRoot}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (packageJson.name !== "etsy-crawler") {
    throw new Error(`Unexpected package name: ${packageJson.name ?? "(missing)"}`);
  }

  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(projectRoot, file))) {
      throw new Error(`Required source-package file is missing: ${file}`);
    }
  }
}

function assertSafeEntries(files) {
  const unsafe = files.filter((file) => {
    const segments = file.split("/");
    if (file !== ".env.example" && isEnvFile(file)) return true;
    if (segments.includes(".git") || segments.includes("node_modules")) return true;
    if (segments.includes("dist") || segments.includes("build") || segments.includes("coverage")) return true;
    if (segments.includes("data") || segments.includes("storage") || segments.includes("output")) return true;
    if (file === "data/etsy-agent/secure-config.json") return true;
    if (file.endsWith("security-events.log")) return true;
    if (file.endsWith(".log")) return true;
    return false;
  });

  if (unsafe.length > 0) {
    throw new Error(`Refusing to package unsafe paths:\n${unsafe.join("\n")}`);
  }
}

async function createZip(files) {
  fs.mkdirSync(outputDir, { recursive: true });
  if (fs.existsSync(outputPath)) fs.rmSync(outputPath);

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const stream = fs.createWriteStream(outputPath);

  const done = new Promise((resolve, reject) => {
    stream.on("close", resolve);
    stream.on("error", reject);
    archive.on("error", reject);
  });

  archive.pipe(stream);

  for (const file of files) {
    archive.file(path.join(projectRoot, file), { name: `${zipRoot}/${file}` });
  }

  await archive.finalize();
  await done;
}

assertProjectRoot();
const files = walk(projectRoot).sort();
assertSafeEntries(files);
await createZip(files);

const sizeBytes = fs.statSync(outputPath).size;
console.log(`Created ${path.relative(projectRoot, outputPath)}`);
console.log(`Packaged ${files.length} source files under ${zipRoot}/`);
console.log(`Size ${(sizeBytes / 1024 / 1024).toFixed(2)} MiB`);
