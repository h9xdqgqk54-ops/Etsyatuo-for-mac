import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const { handleEtsyAgentRoute } = await import("../apiRouter.js");
  const server = http.createServer((req, res) => {
    handleEtsyAgentRoute(req, res).then((handled) => {
      if (!handled && !res.headersSent) {
        res.writeHead(404);
        res.end("Not found");
      }
    }).catch((error) => {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function setupEnv(): void {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-gpt55-settings-"));
  process.env.ETSY_AGENT_DATA_PATH = path.join(tmp, "data");
  process.env.ETSY_AGENT_CONFIG_PATH = path.join(tmp, "data", "secure-config.json");
  process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(tmp, "data", "security.log");
  process.env.ETSY_AGENT_STORAGE_PATH = path.join(tmp, "storage");
  process.env.IMAGE_AGENT_ALLOW_WEB_KEY_CONFIG = "true";
  process.env.IMAGE_AGENT_ENABLE_REAL_GENERATION = "false";
  process.env.OPENAI_API_KEY = "sk-image_abcdefghijklmnopqrstuvwxyz";
  process.env.OPENAI_BASE_URL = "https://image-relay.example.test/v1";
  process.env.OPENAI_IMAGE_MODEL = "gpt-image-2";
  process.env.GPT55_API_KEY = "";
  process.env.GPT55_BASE_URL = "";
  process.env.GPT55_MODEL = "";
  process.env.GPT55_MAX_INPUT_MB = "5";
  process.env.GPT55_BATCH_LIMIT = "10";
}

describe("GPT5.5 prompt provider migration", () => {
  it("exposes GPT5.5 prompt provider separately from gpt-image-2 settings", async () => {
    setupEnv();
    process.env.GPT55_API_KEY = "sk-gpt55_abcdefghijklmnopqrstuvwxyz";
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`);
      const json = await response.json() as {
        ok: boolean;
        data: {
          baseURL: string;
          model: string;
          promptProvider: { provider: string; configured: boolean; baseURL: string; model: string; keySource: string };
        };
      };

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.model).toBe("gpt-image-2");
      expect(json.data.baseURL).toBe("https://image-relay.example.test/v1");
      expect(json.data.promptProvider).toMatchObject({
        provider: "gpt55",
        configured: true,
        keySource: "env",
        baseURL: "https://allin-api.com/v1",
        model: "gpt-5.5",
      });
      expect(JSON.stringify(json)).not.toContain("sk-gpt55_abcdefghijklmnopqrstuvwxyz");
      expect(JSON.stringify(json)).not.toContain("sk-image_abcdefghijklmnopqrstuvwxyz");
    });
  });

  it("stores web-entered GPT5.5 settings without changing image provider settings", async () => {
    setupEnv();
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gpt55ApiKey: "sk-session-gpt55_abcdefghijklmnopqrstuvwxyz",
          gpt55BaseURL: "https://text-relay.example.test/v1/",
          gpt55Model: "gpt-5.5",
        }),
      });
      const json = await response.json() as {
        ok: boolean;
        data: {
          baseURL: string;
          model: string;
          promptProvider: { configured: boolean; keySource: string; baseURL: string; model: string };
        };
      };

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.baseURL).toBe("https://image-relay.example.test/v1");
      expect(json.data.model).toBe("gpt-image-2");
      expect(json.data.promptProvider).toMatchObject({
        configured: true,
        keySource: "session",
        baseURL: "https://text-relay.example.test/v1",
        model: "gpt-5.5",
      });
      expect(JSON.stringify(json)).not.toContain("sk-session-gpt55_abcdefghijklmnopqrstuvwxyz");
    });
  });

  it("tests GPT5.5 text and image pings through the GPT5.5 base URL", async () => {
    setupEnv();
    await withServer(async (baseUrl) => {
      const save = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gpt55ApiKey: "sk-session-gpt55_abcdefghijklmnopqrstuvwxyz",
          gpt55BaseURL: "https://text-relay.example.test/v1",
          gpt55Model: "gpt-5.5",
        }),
      });
      expect(save.status).toBe(200);

      const realFetch = globalThis.fetch.bind(globalThis);
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: "OK" } }],
      }), { status: 200, headers: { "x-request-id": "req_gpt55_test" } }));
      vi.stubGlobal("fetch", fetchMock);

      const response = await realFetch(`${baseUrl}/api/etsy-agent/image-provider-settings/test-prompt-provider`, { method: "POST" });
      const json = await response.json() as { ok: boolean; data: { message: string; status: { promptProvider: { validationStatus: string } } } };

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.message).toContain("GPT5.5");
      expect(json.data.status.promptProvider.validationStatus).toBe("validated");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map((call) => String((call as unknown[])[0]))).toEqual([
        "https://text-relay.example.test/v1/chat/completions",
        "https://text-relay.example.test/v1/chat/completions",
      ]);
    });
  });
});
