import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as nodeModule from "node:module";
import type { ListeningEtsyautoServer, ListenEtsyautoServerOptions } from "../services/app_server.js";

export interface LauncherArgs {
  host: string;
  openBrowser: boolean;
  port: number;
  showHelp: boolean;
}

export interface PortableEnvironmentOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export interface BrowserOpenCommand {
  args: string[];
  command: string;
}

export interface SidecarNodeModuleResolutionOptions {
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  initPaths?: () => void;
  isPkg?: boolean;
  moduleGlobalPaths?: string[];
  platform?: NodeJS.Platform;
}

export type EtsyautoServerListener = (options: ListenEtsyautoServerOptions) => Promise<ListeningEtsyautoServer>;

export interface PortFallbackResult {
  fallbackUsed: boolean;
  listening: ListeningEtsyautoServer;
  requestedPort: number;
}

export function parseLauncherArgs(argv: string[]): LauncherArgs {
  const parsed: LauncherArgs = {
    host: "127.0.0.1",
    openBrowser: true,
    port: 3456,
    showHelp: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      parsed.showHelp = true;
      continue;
    }
    if (arg === "--no-open") {
      parsed.openBrowser = false;
      continue;
    }
    if (arg === "--host") {
      parsed.host = requireNextArg(argv, i, "--host");
      i += 1;
      continue;
    }
    if (arg === "--port") {
      const raw = requireNextArg(argv, i, "--port");
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid --port value: ${raw}`);
      parsed.port = port;
      i += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return parsed;
}

export function buildPortableEnvironment(options: PortableEnvironmentOptions = {}): NodeJS.ProcessEnv {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const homeDir = homeDirForPlatform(platform, env);
  const baseDir = baseDirForPlatform(platform, env, homeDir);
  const dataDir = env.ETSY_AGENT_DATA_PATH || pathApi.join(baseDir, "data");
  return {
    ETSY_AGENT_CONFIG_PATH: env.ETSY_AGENT_CONFIG_PATH || pathApi.join(dataDir, "secure-config.json"),
    ETSY_AGENT_DATA_PATH: dataDir,
    ETSY_AGENT_DESKTOP_ROOT: env.ETSY_AGENT_DESKTOP_ROOT || pathApi.join(homeDir, "Desktop"),
    ETSY_AGENT_FOLDER_SETTINGS_PATH: env.ETSY_AGENT_FOLDER_SETTINGS_PATH || pathApi.join(dataDir, "folder-settings.json"),
    ETSY_AGENT_INPUT_ASSETS_PATH: env.ETSY_AGENT_INPUT_ASSETS_PATH || pathApi.join(dataDir, "input-assets.json"),
    ETSY_AGENT_LISTING_RECORDS_PATH: env.ETSY_AGENT_LISTING_RECORDS_PATH || pathApi.join(dataDir, "listing-records.json"),
    ETSY_AGENT_PRODUCT_WORKBENCH_RECORDS_PATH: env.ETSY_AGENT_PRODUCT_WORKBENCH_RECORDS_PATH || pathApi.join(dataDir, "product-workbench-records.json"),
    ETSY_AGENT_PROMPT_RECORDS_PATH: env.ETSY_AGENT_PROMPT_RECORDS_PATH || pathApi.join(dataDir, "prompt-records.json"),
    ETSY_AGENT_SECURITY_LOG_PATH: env.ETSY_AGENT_SECURITY_LOG_PATH || pathApi.join(dataDir, "security-events.log"),
    ETSY_AGENT_STORAGE_PATH: env.ETSY_AGENT_STORAGE_PATH || pathApi.join(baseDir, "storage"),
    IMAGE_AGENT_ENABLE_REAL_GENERATION: desktopRealGenerationDefault(env),
  };
}

export function applyPortableEnvironment(env = process.env, platform = process.platform): NodeJS.ProcessEnv {
  const portable = buildPortableEnvironment({ env, platform });
  for (const [key, value] of Object.entries(portable)) {
    if (value) env[key] = value;
  }
  ensureDirectory(portable.ETSY_AGENT_DATA_PATH);
  ensureDirectory(portable.ETSY_AGENT_STORAGE_PATH);
  return portable;
}

export function buildBrowserOpenCommand(url: string, platform: NodeJS.Platform = process.platform): BrowserOpenCommand {
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  if (platform === "darwin") return { command: "open", args: [url] };
  return { command: "xdg-open", args: [url] };
}

export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const command = buildBrowserOpenCommand(url, platform);
  const child = spawn(command.command, command.args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

export function buildSidecarNodeModulesPath(execPath = process.execPath): string {
  return path.join(path.dirname(execPath), "node_modules");
}

export function applySidecarNodeModuleResolution(options: SidecarNodeModuleResolutionOptions = {}): string | undefined {
  const isPkg = options.isPkg ?? Boolean((process as unknown as { pkg?: unknown }).pkg);
  if (!isPkg) return undefined;

  const sidecarNodeModules = buildSidecarNodeModulesPath(options.execPath ?? process.execPath);
  if (!fs.existsSync(sidecarNodeModules)) return undefined;

  const env = options.env ?? process.env;
  const delimiter = options.platform === "win32" ? ";" : path.delimiter;
  const existingNodePaths = (env.NODE_PATH ?? "").split(delimiter).filter(Boolean);
  if (!existingNodePaths.includes(sidecarNodeModules)) {
    env.NODE_PATH = [sidecarNodeModules, ...existingNodePaths].join(delimiter);
  }

  const moduleRuntime = nodeModule as unknown as { globalPaths: string[]; _initPaths?: () => void };
  const moduleGlobalPaths = options.moduleGlobalPaths ?? moduleRuntime.globalPaths;
  if (!moduleGlobalPaths.includes(sidecarNodeModules)) {
    moduleGlobalPaths.unshift(sidecarNodeModules);
  }

  const initPaths = options.initPaths ?? (() => moduleRuntime._initPaths?.());
  initPaths();
  return sidecarNodeModules;
}

export function helpText(): string {
  return [
    "Etsyauto CLI Launcher",
    "",
    "Usage:",
    "  Etsyauto.exe [--host 127.0.0.1] [--port 3456] [--no-open]",
    "",
    "Options:",
    "  --host <host>   Host for the local web server. Default: 127.0.0.1",
    "  --port <port>   Port for the local web server. Use 0 for a random free port.",
    "  --no-open       Start the server without opening the browser.",
    "  -h, --help      Show this help message.",
  ].join("\n");
}

export function isAddressInUseError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "EADDRINUSE");
}

export async function listenWithPortFallback(listener: EtsyautoServerListener, options: ListenEtsyautoServerOptions): Promise<PortFallbackResult> {
  const requestedPort = options.port ?? 3456;
  try {
    return {
      fallbackUsed: false,
      listening: await listener(options),
      requestedPort,
    };
  } catch (error) {
    if (!isAddressInUseError(error) || requestedPort === 0) throw error;
    return {
      fallbackUsed: true,
      listening: await listener({ ...options, port: 0 }),
      requestedPort,
    };
  }
}

export async function runCliLauncher(argv = process.argv.slice(2)): Promise<void> {
  const args = parseLauncherArgs(argv);
  if (args.showHelp) {
    console.log(helpText());
    return;
  }

  const portable = applyPortableEnvironment();
  applySidecarNodeModuleResolution();
  const { listenEtsyautoServer } = await import("../services/app_server.js");
  const { fallbackUsed, listening, requestedPort } = await listenWithPortFallback(listenEtsyautoServer, { host: args.host, port: args.port, log: false });
  const workbenchUrl = `${listening.url}/etsy-image-agent`;
  console.log("");
  console.log("Etsyauto 图片 Agent 已启动");
  if (fallbackUsed) console.log(`端口 ${requestedPort} 被占用，已自动切换到 ${listening.port}。`);
  console.log(`工作台: ${workbenchUrl}`);
  console.log(`数据目录: ${portable.ETSY_AGENT_DATA_PATH}`);
  console.log(`素材目录: ${portable.ETSY_AGENT_STORAGE_PATH}`);
  console.log("关闭此窗口即可停止本地服务。");
  console.log("");
  if (args.openBrowser) openBrowser(workbenchUrl);
  process.once("SIGINT", () => void shutdown(listening.close));
  process.once("SIGTERM", () => void shutdown(listening.close));
}

function requireNextArg(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  return value;
}

function baseDirForPlatform(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, homeDir: string): string {
  if (platform === "win32") {
    return path.win32.join(env.APPDATA || path.win32.join(homeDir, "AppData", "Roaming"), "Etsyauto");
  }
  if (platform === "darwin") {
    return path.posix.join(homeDir, "Library", "Application Support", "Etsyauto");
  }
  return path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(homeDir, ".config"), "Etsyauto");
}

function homeDirForPlatform(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform === "win32") {
    if (env.USERPROFILE) return env.USERPROFILE;
    if (env.APPDATA) return path.win32.resolve(env.APPDATA, "..", "..");
    return "C:\\Users\\Default";
  }
  return env.HOME || os.homedir();
}

function ensureDirectory(dir: string | undefined): void {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
}

function desktopRealGenerationDefault(env: NodeJS.ProcessEnv): string {
  const current = env.IMAGE_AGENT_ENABLE_REAL_GENERATION?.trim();
  if (current) return current;
  const legacy = env.ETSY_AGENT_ENABLE_REAL_GENERATION?.trim();
  if (legacy) return legacy;
  return "true";
}

async function shutdown(close: () => Promise<void>): Promise<void> {
  try {
    await close();
  } finally {
    process.exit(0);
  }
}

if (isDirectLauncherRun()) {
  runCliLauncher().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isDirectLauncherRun(): boolean {
  if ((process as unknown as { pkg?: unknown }).pkg) return true;
  if (!process.argv[1]) return false;
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return true;
  }
}
