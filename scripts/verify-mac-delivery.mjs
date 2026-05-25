import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const zipPath = path.resolve(process.argv[2] ?? path.join(projectRoot, "dist", "delivery", "Etsyauto-Mac.zip"));
const timeoutMs = Number(process.env.ETSYAUTO_VERIFY_TIMEOUT_MS ?? 20_000);

function fail(message) {
  throw new Error(message);
}

function assertExists(filePath, label) {
  if (!fs.existsSync(filePath)) fail(`Missing ${label}: ${filePath}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
  if (result.error) fail(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed with ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function findMacPackageRoot(tempDir) {
  const packageDir = path.join(tempDir, "Etsyauto-Mac");
  assertExists(packageDir, "Etsyauto-Mac package directory");
  return packageDir;
}

function assertExecutable(filePath, label) {
  assertExists(filePath, label);
  const mode = fs.statSync(filePath).mode;
  if ((mode & 0o111) === 0) fail(`${label} is not executable: ${filePath}`);
}

function httpStatus(url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: "HEAD", timeout: 5000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error(`HTTP timeout: ${url}`));
    });
    req.end();
  });
}

function waitForWorkbenchUrl(child) {
  let output = "";
  let settled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Timed out waiting for workbench URL.\n${output}`));
    }, timeoutMs);

    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/工作台:\s*(http:\/\/[^\s]+)/);
      if (!match) return;
      settled = true;
      clearTimeout(timer);
      resolve({ output, url: match[1] });
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Mac launcher exited before printing workbench URL. Code: ${code}\n${output}`));
    });
  });
}

function stopProcessGroup(child) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already stopped.
    }
  }
}

async function main() {
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    fail("Mac delivery verification must run on Apple Silicon macOS (darwin-arm64).");
  }

  assertExists(zipPath, "Etsyauto-Mac.zip");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "etsyauto-mac-delivery-"));
  try {
    run("ditto", ["-x", "-k", zipPath, tempDir]);
    const packageDir = findMacPackageRoot(tempDir);
    const commandPath = path.join(packageDir, "启动 Etsyauto.command");
    const executablePath = path.join(packageDir, "Etsyauto");

    assertExecutable(commandPath, "启动 Etsyauto.command");
    assertExecutable(executablePath, "Etsyauto executable");
    assertExists(path.join(packageDir, "public", "etsy-image-agent.html"), "workbench HTML");
    assertExists(path.join(packageDir, "public", "openai-settings.html"), "settings HTML");
    assertExists(path.join(packageDir, "public", "openai-settings.js"), "settings JavaScript");
    const settingsHtml = fs.readFileSync(path.join(packageDir, "public", "openai-settings.html"), "utf8");
    const settingsJs = fs.readFileSync(path.join(packageDir, "public", "openai-settings.js"), "utf8");
    if (!settingsHtml.includes("OPENAI_IMAGE_MODEL") || !settingsHtml.includes("imageModelInput")) fail("settings page does not expose OPENAI_IMAGE_MODEL");
    if (!settingsJs.includes("openaiImageModel") || !settingsJs.includes("Image model source")) fail("settings JavaScript does not save OPENAI_IMAGE_MODEL");
    assertExists(path.join(packageDir, "node_modules", "sharp", "lib", "sharp.js"), "sharp JavaScript package");
    assertExists(path.join(packageDir, "node_modules", "@img", "sharp-darwin-arm64", "lib", "sharp-darwin-arm64.node"), "sharp darwin arm64 native module");

    run(process.execPath, ["-e", "require('sharp'); console.log('sharp ok')"], {
      env: {
        ...process.env,
        NODE_PATH: path.join(packageDir, "node_modules"),
      },
    });

    const child = spawn(commandPath, ["--no-open", "--port", "0"], {
      cwd: packageDir,
      detached: true,
      env: {
        ...process.env,
        ETSYAUTO_NO_PAUSE: "1",
        ETSY_AGENT_CONFIG_PATH: path.join(tempDir, "data", "secure-config.json"),
        ETSY_AGENT_DATA_PATH: path.join(tempDir, "data"),
        ETSY_AGENT_FOLDER_SETTINGS_PATH: path.join(tempDir, "data", "folder-settings.json"),
        ETSY_AGENT_INPUT_ASSETS_PATH: path.join(tempDir, "data", "input-assets.json"),
        ETSY_AGENT_LISTING_RECORDS_PATH: path.join(tempDir, "data", "listing-records.json"),
        ETSY_AGENT_PRODUCT_WORKBENCH_RECORDS_PATH: path.join(tempDir, "data", "product-workbench-records.json"),
        ETSY_AGENT_PROMPT_RECORDS_PATH: path.join(tempDir, "data", "prompt-records.json"),
        ETSY_AGENT_SECURITY_LOG_PATH: path.join(tempDir, "data", "security-events.log"),
        ETSY_AGENT_STORAGE_PATH: path.join(tempDir, "storage"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      const { url: workbenchUrl } = await waitForWorkbenchUrl(child);
      const settingsUrl = new URL("/settings/openai", workbenchUrl).toString();
      const workbenchStatus = await httpStatus(workbenchUrl);
      const settingsStatus = await httpStatus(settingsUrl);
      if (workbenchStatus !== 200) fail(`/etsy-image-agent returned ${workbenchStatus}`);
      if (settingsStatus !== 200) fail(`/settings/openai returned ${settingsStatus}`);
      console.log(`Mac delivery verified: ${zipPath}`);
      console.log(`Workbench URL: ${workbenchUrl}`);
    } finally {
      stopProcessGroup(child);
    }
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
