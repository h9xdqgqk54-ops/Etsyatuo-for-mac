import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
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

function setupEnv(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-api-settings-"));
  process.env.ETSY_AGENT_CONFIG_PATH = path.join(tmp, "secure-config.json");
  process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(tmp, "security.log");
  process.env.ETSY_AGENT_STORAGE_PATH = path.join(tmp, "storage");
  process.env.IMAGE_AGENT_PROVIDER = "openai";
  process.env.IMAGE_AGENT_ALLOW_WEB_KEY_CONFIG = "true";
  process.env.IMAGE_AGENT_ENABLE_REAL_GENERATION = "false";
  process.env.OPENAI_API_KEY = "";
  process.env.OPENAI_BASE_URL = "";
  process.env.OPENAI_IMAGE_MODEL = "gpt-image-2";
  process.env.OPENAI_IMAGE_SIZE = "1024x1024";
  process.env.OPENAI_IMAGE_QUALITY = "low";
  process.env.OPENAI_IMAGE_INPUT_FIDELITY = "";
  return tmp;
}

describe("OpenAI-only settings API routes", () => {
  it("GET image-provider-settings exposes only OpenAI status and no plaintext key", async () => {
    setupEnv();
    const plaintext = "sk-test_abcdefghijklmnopqrstuvwxyz";
    process.env.OPENAI_API_KEY = plaintext;
    process.env.IMAGE_AGENT_PROVIDER = "legacy-provider";
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`);
      const json = await response.json() as { ok: boolean; data: Record<string, unknown> };
      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.selectedProvider).toBe("openai");
      expect(json.data.provider).toBe("openai");
      expect(json.data.baseURL).toBe("");
      expect(json.data.baseURLSource).toBe("default");
      expect(json.data.inputFidelity).toBe("off");
      expect(json.data.inputFidelitySource).toBe("default");
      expect((json.data.providers as unknown[])).toHaveLength(1);
      expect(Object.keys(json.data.providersById as Record<string, unknown>)).toEqual(["openai"]);
      expect((json.data.publicBaseUrl as { note: string }).note).toBe("not required for OpenAI");
      expect((json.data.flags as { realGenerationEnabled: boolean; mockMode: boolean })).toEqual({ realGenerationEnabled: false, mockMode: false });
      expect(JSON.stringify(json)).not.toContain(plaintext);
      expect(JSON.stringify(json)).not.toContain("abcdefghijklmnopqrstuvwxyz");
    });
  });

  it("reports OPENAI_API_KEY_MISSING when OpenAI key is absent", async () => {
    setupEnv();
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings/test`, { method: "POST" });
      const json = await response.json() as { ok: boolean; error: string; data: { status: { selectedProvider: string } } };
      expect(response.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.error).toContain("OPENAI_API_KEY_MISSING");
      expect(json.data.status.selectedProvider).toBe("openai");
    });
  });

  it("reports OPENAI_API_KEY_MISSING when env key is still the placeholder", async () => {
    setupEnv();
    process.env.OPENAI_API_KEY = "your_openai_key_here";
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings/test`, { method: "POST" });
      const json = await response.json() as { ok: boolean; error: string; data: { status: { configured: boolean; source: string; maskedKey: string } } };
      expect(response.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.error).toContain("OPENAI_API_KEY_MISSING");
      expect(json.data.status.configured).toBe(false);
      expect(json.data.status.source).toBe("not_configured");
      expect(json.data.status.maskedKey).toBe("");
      expect(JSON.stringify(json)).not.toContain("your_openai_key_here");
    });
  });

  it("stores web-entered OpenAI key only in server session memory", async () => {
    const tmp = setupEnv();
    const plaintext = "sk-test_abcdefghijklmnopqrstuvwxyz";
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: plaintext, openaiBaseURL: "https://relay.example.test/v1/", openaiInputFidelity: "high" }),
      });
      const json = await response.json() as { ok: boolean; data: { configured: boolean; source: string; maskedKey: string; baseURL: string; baseURLSource: string; inputFidelity: string; inputFidelitySource: string } };
      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.configured).toBe(true);
      expect(json.data.source).toBe("session");
      expect(json.data.maskedKey).toMatch(/^sk-tes\.\.\./);
      expect(json.data.baseURL).toBe("https://relay.example.test/v1");
      expect(json.data.baseURLSource).toBe("session");
      expect(json.data.inputFidelity).toBe("high");
      expect(json.data.inputFidelitySource).toBe("session");
      expect(JSON.stringify(json)).not.toContain(plaintext);
      expect(fs.existsSync(path.join(tmp, "secure-config.json"))).toBe(false);
    });
  });

  it("exposes env OpenAI Base URL without treating it as a key", async () => {
    setupEnv();
    process.env.OPENAI_BASE_URL = "https://env-relay.example.test/v1/";
    process.env.OPENAI_IMAGE_INPUT_FIDELITY = "low";
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`);
      const json = await response.json() as { ok: boolean; data: { baseURL: string; baseURLSource: string; inputFidelity: string; inputFidelitySource: string; providersById: { openai: { baseURL: string; baseURLSource: string; inputFidelity: string; inputFidelitySource: string } } } };
      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.baseURL).toBe("https://env-relay.example.test/v1");
      expect(json.data.baseURLSource).toBe("env");
      expect(json.data.inputFidelity).toBe("low");
      expect(json.data.inputFidelitySource).toBe("env");
      expect(json.data.providersById.openai.baseURL).toBe("https://env-relay.example.test/v1");
      expect(json.data.providersById.openai.baseURLSource).toBe("env");
      expect(json.data.providersById.openai.inputFidelity).toBe("low");
      expect(json.data.providersById.openai.inputFidelitySource).toBe("env");
    });
  });

  it("returns 410 for removed legacy image-agent flows", async () => {
    setupEnv();
    await withServer(async (baseUrl) => {
      for (const route of ["/api/etsy-agent/group", "/api/etsy-agent/tasks", "/api/etsy-agent/reference-preflight", "/api/etsy-agent/estimate"]) {
        const response = await fetch(`${baseUrl}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const json = await response.json() as { ok: boolean; error: string };
        expect(response.status).toBe(410);
        expect(json.ok).toBe(false);
        expect(json.error).toMatch(/REMOVED/);
      }
    });
  });

  it("legacy openai-settings route remains compatible but OpenAI-only", async () => {
    setupEnv();
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/openai-settings`);
      const json = await response.json() as { ok: boolean; deprecated: boolean; data: { selectedProvider: string; providers: unknown[] } };
      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.deprecated).toBe(true);
      expect(json.data.selectedProvider).toBe("openai");
      expect(json.data.providers).toHaveLength(1);
    });
  });
});
