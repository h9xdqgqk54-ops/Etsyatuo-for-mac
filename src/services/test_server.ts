/**
 * Minimal local dev server for test_panel.html
 *
 * Serves the frontend page and proxies API calls to Image2 / Deepseek,
 * reading API keys from .env so the browser never sees them.
 *
 * Usage: pnpm tsx src/services/test_server.ts
 * Then open: http://localhost:3456
 */

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import dotenv from "dotenv";

dotenv.config();

const PORT = 3456;
const PUBLIC_DIR = path.resolve("public");
const OUTPUT_DIR = path.resolve("output");

const IMAGE2_API_KEY = process.env.IMAGE2_API_KEY ?? "";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY ?? "";

// ── MIME map ─────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ── Helpers ──────────────────────────────────────────────────

function ext(p: string): string {
  return path.extname(p).toLowerCase();
}

function reply(res: http.ServerResponse, status: number, body: string | Buffer, contentType?: string): void {
  const ct = contentType ?? "text/plain; charset=utf-8";
  res.writeHead(status, { "Content-Type": ct, "Access-Control-Allow-Origin": "*" });
  res.end(body);
}

function replyJSON(res: http.ServerResponse, status: number, data: unknown): void {
  reply(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

function serveFile(res: http.ServerResponse, filePath: string): void {
  if (!fs.existsSync(filePath)) {
    reply(res, 404, "Not Found");
    return;
  }
  const data = fs.readFileSync(filePath);
  reply(res, 200, data, MIME[ext(filePath)] ?? "application/octet-stream");
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ── API Proxies ──────────────────────────────────────────────

/**
 * Proxy to Image2 API.
 * The frontend sends { prompt: "..." }, we add the API key from .env
 * and forward to the real Image2 endpoint.
 *
 * Replace the url below with the actual Image2 API endpoint.
 */
async function handleImage2(_req: http.IncomingMessage, res: http.ServerResponse, body: string): Promise<void> {
  if (!IMAGE2_API_KEY) {
    replyJSON(res, 500, { error: "IMAGE2_API_KEY not set in .env" });
    return;
  }

  let parsed: { prompt?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    replyJSON(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!parsed.prompt) {
    replyJSON(res, 400, { error: "Missing 'prompt' field" });
    return;
  }

  try {
    // ══════════════════════════════════════════════════════════
    // REPLACE with your actual Image2 API endpoint + auth scheme
    // ══════════════════════════════════════════════════════════
    const apiRes = await fetch("https://api.image2.example/v1/generate", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${IMAGE2_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: parsed.prompt,
        style: "product",
        size: "1024x1024",
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => "Unknown error");
      replyJSON(res, apiRes.status, { error: `Image2 API error: ${errText}` });
      return;
    }

    const data = await apiRes.json();
    // The frontend expects { url } or { image_url }
    replyJSON(res, 200, data);
  } catch (err) {
    replyJSON(res, 502, { error: `Image2 proxy error: ${err instanceof Error ? err.message : err}` });
  }
}

/**
 * Proxy to Deepseek API.
 * The frontend sends { prompt: "..." }, we add the API key from .env
 * and forward to the Deepseek chat completions endpoint.
 *
 * Replace the model / baseURL as needed.
 */
async function handleDeepseek(_req: http.IncomingMessage, res: http.ServerResponse, body: string): Promise<void> {
  if (!DEEPSEEK_API_KEY) {
    replyJSON(res, 500, { error: "DEEPSEEK_API_KEY not set in .env" });
    return;
  }

  let parsed: { prompt?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    replyJSON(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!parsed.prompt) {
    replyJSON(res, 400, { error: "Missing 'prompt' field" });
    return;
  }

  try {
    // ══════════════════════════════════════════════════════════
    // REPLACE with your actual Deepseek SDK or REST call
    // ══════════════════════════════════════════════════════════
    const apiRes = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "user", content: parsed.prompt },
        ],
        temperature: 0.7,
        max_tokens: 800,
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => "Unknown error");
      replyJSON(res, apiRes.status, { error: `Deepseek API error: ${errText}` });
      return;
    }

    const data = await apiRes.json();
    const text = data.choices?.[0]?.message?.content ?? "";
    // The frontend expects { text } or { content }
    replyJSON(res, 200, { text });
  } catch (err) {
    replyJSON(res, 502, { error: `Deepseek proxy error: ${err instanceof Error ? err.message : err}` });
  }
}

// ── Static Routes ────────────────────────────────────────────

function serveTasksCSV(res: http.ServerResponse): void {
  const p = path.join(OUTPUT_DIR, "future_generation_tasks.csv");
  serveFile(res, p);
}

// ── Router ───────────────────────────────────────────────────

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  // API routes
  if (method === "POST" && url === "/api/generate-image") {
    const body = await readBody(req);
    return handleImage2(req, res, body);
  }

  if (method === "POST" && url === "/api/generate-text") {
    const body = await readBody(req);
    return handleDeepseek(req, res, body);
  }

  if (method === "GET" && url === "/api/tasks-csv") {
    return serveTasksCSV(res);
  }

  // Static files
  if (method === "GET") {
    // Serve from output/ (for CSV files)
    if (url.startsWith("/output/")) {
      const safe = path.normalize(url).replace(/^[/\\]/, "");
      return serveFile(res, path.resolve(safe));
    }

    // Root → test_panel.html
    if (url === "/" || url === "/index.html") {
      return serveFile(res, path.join(PUBLIC_DIR, "test_panel.html"));
    }

    // Any other file in public/
    const safe = path.normalize(url).replace(/^[/\\]/, "");
    const publicPath = path.join(PUBLIC_DIR, safe);
    if (fs.existsSync(publicPath) && publicPath.startsWith(PUBLIC_DIR)) {
      return serveFile(res, publicPath);
    }

    return reply(res, 404, "Not Found");
  }

  reply(res, 405, "Method Not Allowed");
}

// ── Start ────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error("Unhandled error:", err);
    if (!res.headersSent) {
      reply(res, 500, "Internal Server Error");
    }
  });
});

server.listen(PORT, () => {
  console.log("");
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Etsy → 1688 Test Panel Server         ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("");
  console.log(`  Local:  http://localhost:${PORT}`);
  console.log("");
  console.log(`  IMAGE2_API_KEY:   ${IMAGE2_API_KEY ? "loaded ✓" : "NOT SET ✗"}`);
  console.log(`  DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY ? "loaded ✓" : "NOT SET ✗"}`);
  console.log("");
  console.log("  Press Ctrl+C to stop.");
  console.log("");
});
