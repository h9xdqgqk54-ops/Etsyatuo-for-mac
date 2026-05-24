/**
 * Etsyauto local API server.
 *
 * The production surface is intentionally small:
 *   - /etsy-image-agent
 *   - /settings/openai
 *   - /api/etsy-agent/*
 *
 * Older demo workflow routes return 410 so Windows users cannot
 * accidentally enter a removed flow.
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { handleEtsyAgentRoute, tryServeEtsyMedia } from "./etsyImageAgent/apiRouter.js";

dotenv.config();

export const DEFAULT_PORT = 3456;
const PUBLIC_DIR = resolvePublicDir();

const GPT55_KEY = process.env.GPT55_API_KEY ?? "";
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const WORKBENCH_ROUTES = new Map<string, string>([
  ["/etsy-image-agent", "etsy-image-agent.html"],
  ["/settings/openai", "openai-settings.html"],
]);

const REMOVED_PAGE_ROUTES = new Set([
  "/asset-library",
  "/app",
  "/app.html",
  "/test-panel",
  "/test_panel",
  "/test_panel.html",
]);

function reply(res: http.ServerResponse, status: number, data: unknown, ct?: string): void {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": ct ?? "application/json; charset=utf-8",
  });
  res.end(body);
}

function redirectToWorkbench(res: http.ServerResponse): void {
  res.writeHead(302, { Location: "/etsy-image-agent" });
  res.end();
}

function serveFile(res: http.ServerResponse, filePath: string, headOnly = false): void {
  if (!fs.existsSync(filePath)) {
    reply(res, 404, "Not Found", "text/plain; charset=utf-8");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Content-Length": data.length,
    "Content-Type": MIME[ext] ?? "application/octet-stream",
  });
  if (headOnly) {
    res.end();
    return;
  }
  res.end(data);
}

export async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";
  const pathname = url.pathname;

  if (method === "OPTIONS") return reply(res, 200, { ok: true });
  if (tryServeEtsyMedia(req, res)) return;
  if (await handleEtsyAgentRoute(req, res)) return;

  if (isLegacyDemoApi(pathname)) {
    return reply(res, 410, {
      ok: false,
      error: "LEGACY_WORKFLOW_REMOVED：旧 demo API 已移除，请使用 /etsy-image-agent。",
    });
  }

  if (method === "GET" || method === "HEAD") {
    const headOnly = method === "HEAD";

    if (pathname === "/") {
      if (method === "GET") return redirectToWorkbench(res);
      return servePublicFile(res, "etsy-image-agent.html", headOnly);
    }

    if (REMOVED_PAGE_ROUTES.has(pathname)) return redirectToWorkbench(res);

    const workbenchFile = WORKBENCH_ROUTES.get(pathname);
    if (workbenchFile) return servePublicFile(res, workbenchFile, headOnly);

    if (pathname.startsWith("/public/")) {
      return servePublicFile(res, decodeURIComponent(pathname.slice("/public/".length)), headOnly);
    }

    const rootAsset = publicRootAsset(pathname);
    if (rootAsset) return servePublicFile(res, rootAsset, headOnly);
  }

  reply(res, 404, { ok: false, error: "Not found" });
}

function servePublicFile(res: http.ServerResponse, relativePath: string, headOnly = false): void {
  const safePath = safePublicPath(relativePath);
  if (!safePath) {
    reply(res, 400, "Bad public path", "text/plain; charset=utf-8");
    return;
  }
  serveFile(res, safePath, headOnly);
}

function publicRootAsset(pathname: string): string | undefined {
  const basename = path.posix.basename(pathname);
  if (!basename || basename !== pathname.slice(1)) return undefined;
  const ext = path.extname(basename).toLowerCase();
  return MIME[ext] ? basename : undefined;
}

function safePublicPath(relativePath: string): string | undefined {
  const normalized = path.normalize(relativePath).replace(/^[/\\]+/, "");
  const resolved = path.resolve(PUBLIC_DIR, normalized);
  return isPathInside(PUBLIC_DIR, resolved) ? resolved : undefined;
}

function isPathInside(root: string, filePath: string): boolean {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isLegacyDemoApi(pathname: string): boolean {
  return pathname.startsWith("/api/") && pathname !== "/api/etsy-agent" && !pathname.startsWith("/api/etsy-agent/");
}

export function createEtsyautoServer(): http.Server {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("Server error:", err);
      if (!res.headersSent) reply(res, 500, { error: "Internal error" });
    });
  });
}

export interface ListenEtsyautoServerOptions {
  host?: string;
  port?: number;
  log?: boolean;
}

export interface ListeningEtsyautoServer {
  server: http.Server;
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

export function listenEtsyautoServer(options: ListenEtsyautoServerOptions = {}): Promise<ListeningEtsyautoServer> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host;
  const log = options.log ?? true;
  const server = createEtsyautoServer();
  (globalThis as unknown as { __etsyautoServer?: http.Server }).__etsyautoServer = server;

  return new Promise((resolve, reject) => {
    let settled = false;
    const onError = (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    server.once("error", onError);
    const onListening = () => {
      if (settled) return;
      settled = true;
      server.off("error", onError);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      const displayHost = host && host !== "0.0.0.0" ? host : "localhost";
      const url = `http://${displayHost}:${actualPort}`;
      if (log) logStartup(url);
      resolve({
        server,
        host: displayHost,
        port: actualPort,
        url,
        close: () => new Promise<void>((closeResolve, closeReject) => {
          server.close((error) => {
            if (error) closeReject(error);
            else closeResolve();
          });
        }),
      });
    };
    if (host) server.listen(port, host, onListening);
    else server.listen(port, onListening);
  });
}

function startLocalServer(): void {
  listenEtsyautoServer({ port: DEFAULT_PORT }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${DEFAULT_PORT} is already in use. Stop the existing Etsyauto dev server before starting another one.`);
      process.exitCode = 1;
      return;
    }
    console.error("Server listen error:", error.message);
    process.exitCode = 1;
  });
}

function logStartup(url: string): void {
  console.log("");
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   Etsyauto 图片 Agent                       ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("");
  console.log(`   Open:         ${url}`);
  console.log(`   GPT5.5:       ${GPT55_KEY ? "configured" : "not set"}`);
  console.log(`   OpenAI Image: ${OPENAI_KEY ? "configured" : "not set"}`);
  console.log("");
}

if (isDirectAppServerRun()) {
  startLocalServer();
}

function isDirectAppServerRun(): boolean {
  if (!process.argv[1]) return false;
  try {
    return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

function resolvePublicDir(): string {
  const candidates = [
    process.env.ETSYAUTO_PUBLIC_DIR,
    path.resolve("public"),
    moduleRelativePublicDir(),
    packageEntrypointPublicDir(),
    path.resolve(path.dirname(process.execPath), "public"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? path.resolve("public");
}

function moduleRelativePublicDir(): string | undefined {
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
  } catch {
    return undefined;
  }
}

function packageEntrypointPublicDir(): string | undefined {
  const entrypoint = (process as unknown as { pkg?: { entrypoint?: string } }).pkg?.entrypoint;
  return entrypoint ? path.resolve(path.dirname(entrypoint), "../../public") : undefined;
}
