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
  process.env.PROMPT_PROVIDER = "gpt55";
  process.env.GPT55_API_KEY = "";
  process.env.GPT55_BASE_URL = "";
  process.env.GPT55_MODEL = "";
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
      expect(json.data.baseURL).toBe("https://allin-api.com/v1");
      expect(json.data.baseURLSource).toBe("default");
      expect(json.data.inputFidelity).toBe("off");
      expect(json.data.inputFidelitySource).toBe("default");
      expect((json.data.providers as unknown[])).toHaveLength(1);
      expect(Object.keys(json.data.providersById as Record<string, unknown>)).toEqual(["openai"]);
      expect((json.data.publicBaseUrl as { note: string }).note).toBe("not required for OpenAI");
      expect((json.data.promptProvider as { provider: string; configured: boolean }).provider).toBe("gpt55");
      expect((json.data.promptProvider as { configured: boolean }).configured).toBe(false);
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

  it("uses recommended GPT5.5 vision model when .env still has a placeholder model", async () => {
    setupEnv();
    process.env.GPT55_MODEL = "your_gpt55_model_here";
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`);
      const json = await response.json() as { ok: boolean; data: { promptProvider: { configured: boolean; model: string; modelSource: string; modelConfigured: boolean; apiKeyConfigured: boolean } } };
      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.promptProvider).toMatchObject({
        configured: false,
        apiKeyConfigured: false,
        modelConfigured: true,
        model: "gpt-5.5",
        modelSource: "default",
      });
    });
  });

  it("keeps GPT5.5 key status separate from model status", async () => {
    setupEnv();
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gpt55ApiKey: "sk-session-gpt55_abcdefghijklmnopqrstuvwxyz" }),
      });
      const json = await response.json() as { ok: boolean; data: { promptProvider: { configured: boolean; apiKeyConfigured: boolean; keySource: string; model: string; modelSource: string } } };
      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.promptProvider).toMatchObject({
        configured: true,
        apiKeyConfigured: true,
        keySource: "session",
        model: "gpt-5.5",
        modelSource: "default",
      });
      expect(JSON.stringify(json)).not.toContain("sk-session-gpt55_abcdefghijklmnopqrstuvwxyz");
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

  it("exposes GPT5.5 prompt provider status without plaintext GPT5.5 key", async () => {
    setupEnv();
    const arkPlaintext = "sk-env-gpt55_abcdefghijklmnopqrstuvwxyz";
    process.env.GPT55_API_KEY = arkPlaintext;
    process.env.GPT55_MODEL = "fake-vision-model";
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`);
      const json = await response.json() as { ok: boolean; data: { promptProvider: { provider: string; configured: boolean; model: string; maskedKey: string; supportsImageInput: string } } };
      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.promptProvider).toMatchObject({
        provider: "gpt55",
        configured: true,
        model: "fake-vision-model",
        supportsImageInput: "configured",
      });
      expect(json.data.promptProvider.maskedKey).toContain("...");
      expect(JSON.stringify(json)).not.toContain(arkPlaintext);
    });
  });

  it("stores web-entered GPT5.5 prompt settings only in server session memory", async () => {
    const tmp = setupEnv();
    process.env.GPT55_BASE_URL = "";
    const arkPlaintext = "sk-session-gpt55_abcdefghijklmnopqrstuvwxyz";
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gpt55ApiKey: arkPlaintext,
          gpt55BaseURL: "https://gpt55-session.example.test/v1/",
          gpt55Model: "gpt-5.5",
        }),
      });
      const json = await response.json() as { ok: boolean; data: { promptProvider: { configured: boolean; keySource: string; maskedKey: string; baseURL: string; model: string; supportsImageInput: string }; configured: boolean } };
      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.promptProvider).toMatchObject({
        configured: true,
        keySource: "session",
        baseURL: "https://gpt55-session.example.test/v1",
        baseURLSource: "session",
        model: "gpt-5.5",
        modelSource: "session",
        supportsImageInput: "configured",
      });
      expect(json.data.promptProvider.maskedKey).toMatch(/^sk-ses\.\.\./);
      expect(json.data.configured).toBe(false);
      expect(JSON.stringify(json)).not.toContain(arkPlaintext);
      expect(JSON.stringify(json)).not.toContain("session-gpt55");
      expect(fs.existsSync(path.join(tmp, "secure-config.json"))).toBe(false);
    });
  });

  it("uses session GPT5.5 model and base URL ahead of env while keeping env key ahead", async () => {
    setupEnv();
    const envGpt55Plaintext = "sk-env-gpt55_abcdefghijklmnopqrstuvwxyz";
    const sessionGpt55Plaintext = "sk-session-gpt55_abcdefghijklmnopqrstuvwxyz";
    process.env.GPT55_API_KEY = envGpt55Plaintext;
    process.env.GPT55_BASE_URL = "https://gpt55-env.example.test/v1/";
    process.env.GPT55_MODEL = "env-gpt55-model";
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gpt55ApiKey: sessionGpt55Plaintext,
          gpt55BaseURL: "https://gpt55-session.example.test/v1",
          gpt55Model: "gpt-5.5",
        }),
      });
      const json = await response.json() as { ok: boolean; data: { promptProvider: { configured: boolean; keySource: string; baseURL: string; baseURLSource: string; model: string; modelSource: string; modelOverriddenBySession: boolean } } };
      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.promptProvider).toMatchObject({
        configured: true,
        keySource: "env",
        baseURL: "https://gpt55-session.example.test/v1",
        baseURLSource: "session",
        model: "gpt-5.5",
        modelSource: "session",
        modelOverriddenBySession: true,
      });
      expect(JSON.stringify(json)).not.toContain(envGpt55Plaintext);
      expect(JSON.stringify(json)).not.toContain(sessionGpt55Plaintext);
    });
  });

  it("deletes only the web-entered GPT5.5 key while leaving env settings effective", async () => {
    setupEnv();
    process.env.GPT55_BASE_URL = "";
    await withServer(async (baseUrl) => {
      const save = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gpt55ApiKey: "sk-session-gpt55_abcdefghijklmnopqrstuvwxyz", gpt55Model: "gpt-5.5" }),
      });
      expect(save.status).toBe(200);

      const deleted = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings/gpt55-key`, { method: "DELETE" });
      const deletedJson = await deleted.json() as { ok: boolean; data: { promptProvider: { configured: boolean; keySource: string; model: string; pendingModel?: string } } };
      expect(deleted.status).toBe(200);
      expect(deletedJson.ok).toBe(true);
      expect(deletedJson.data.promptProvider.configured).toBe(false);
      expect(deletedJson.data.promptProvider.keySource).toBe("none");
      expect(deletedJson.data.promptProvider.model).toBe("gpt-5.5");
      expect(deletedJson.data.promptProvider.pendingModel).toBeUndefined();
    });

    vi.resetModules();
    setupEnv();
    process.env.GPT55_API_KEY = "sk-env-gpt55_abcdefghijklmnopqrstuvwxyz";
    process.env.GPT55_MODEL = "env-gpt55-model";
    await withServer(async (baseUrl) => {
      const deleted = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings/gpt55-key`, { method: "DELETE" });
      const json = await deleted.json() as { ok: boolean; data: { promptProvider: { configured: boolean; keySource: string; model: string } } };
      expect(deleted.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.promptProvider).toMatchObject({ configured: true, keySource: "env", model: "env-gpt55-model" });
    });
  });

  it("tests GPT5.5 prompt provider configuration with real text and image pings", async () => {
    setupEnv();
    await withServer(async (baseUrl) => {
      let response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings/test-prompt-provider`, { method: "POST" });
      const missingJson = await response.json() as { ok: boolean; error: string; data: { status: { promptProvider: { configured: boolean } } } };
      expect(response.status).toBe(400);
      expect(missingJson.ok).toBe(false);
      expect(missingJson.error).toContain("GPT55_API_KEY_MISSING");
      expect(missingJson.data.status.promptProvider.configured).toBe(false);

      response = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gpt55ApiKey: "sk-session-gpt55_abcdefghijklmnopqrstuvwxyz", gpt55Model: "gpt-5.5" }),
      });
      expect(response.status).toBe(200);

      const realFetch = globalThis.fetch.bind(globalThis);
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200, headers: { "x-request-id": "req_prompt_test" } }));
      vi.stubGlobal("fetch", fetchMock);
      response = await realFetch(`${baseUrl}/api/etsy-agent/image-provider-settings/test-prompt-provider`, { method: "POST" });
      const okJson = await response.json() as { ok: boolean; data: { message: string; status: { promptProvider: { configured: boolean; keySource: string; model: string; validationStatus: string } } } };
      expect(response.status).toBe(200);
      expect(okJson.ok).toBe(true);
      expect(okJson.data.message).toContain("vision validated");
      expect(okJson.data.status.promptProvider).toMatchObject({
        configured: true,
        keySource: "session",
        model: "gpt-5.5",
        validationStatus: "validated",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(okJson)).not.toContain("sk-session-gpt55_abcdefghijklmnopqrstuvwxyz");
    });
  });

  it("reports GPT5.5 text endpoint image-ping failures without leaking the key", async () => {
    setupEnv();
    await withServer(async (baseUrl) => {
      const save = await fetch(`${baseUrl}/api/etsy-agent/image-provider-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gpt55ApiKey: "sk-session-gpt55_abcdefghijklmnopqrstuvwxyz", gpt55Model: "session-text-endpoint" }),
      });
      expect(save.status).toBe(200);
      const realFetch = globalThis.fetch.bind(globalThis);
      vi.stubGlobal("fetch", vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "llm model received multi-modal messages" } }), { status: 400 })));
      const response = await realFetch(`${baseUrl}/api/etsy-agent/image-provider-settings/test-prompt-provider`, { method: "POST" });
      const json = await response.json() as { ok: boolean; error: string; data: { status: { promptProvider: { validationStatus: string; lastValidationError?: { code: string } } } } };
      expect(response.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.error).toContain("GPT55_VISION_NOT_SUPPORTED");
      expect(json.data.status.promptProvider.validationStatus).toBe("failed");
      expect(json.data.status.promptProvider.lastValidationError?.code).toBe("GPT55_VISION_NOT_SUPPORTED");
      expect(JSON.stringify(json)).not.toContain("sk-session-gpt55_abcdefghijklmnopqrstuvwxyz");
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

  it("stores image input and output folder settings through the API", async () => {
    const tmp = setupEnv();
    const envInputDir = path.join(tmp, "env-input");
    const envOutputDir = path.join(tmp, "env-output");
    const chosenInputDir = path.join(tmp, "chosen-input");
    const chosenOutputDir = path.join(tmp, "chosen-output");
    for (const dir of [envInputDir, envOutputDir, chosenInputDir, chosenOutputDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    process.env.IMAGE_AGENT_INPUT_DIR = envInputDir;
    process.env.IMAGE_AGENT_OUTPUT_DIR = envOutputDir;
    process.env.ETSY_AGENT_FOLDER_SETTINGS_PATH = path.join(tmp, "folder-settings.json");

    await withServer(async (baseUrl) => {
      let response = await fetch(`${baseUrl}/api/etsy-agent/folder-settings`);
      let json = await response.json() as { ok: boolean; data: { inputDir: string; outputDir: string; sources: { inputDir: string; outputDir: string } } };
      expect(response.status).toBe(200);
      expect(json.data).toMatchObject({
        inputDir: envInputDir,
        outputDir: envOutputDir,
        sources: { inputDir: "env", outputDir: "env" },
      });
      expect(json.data).not.toHaveProperty("promptDir");

      response = await fetch(`${baseUrl}/api/etsy-agent/folder-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputDir: chosenInputDir, outputDir: chosenOutputDir }),
      });
      json = await response.json() as { ok: boolean; data: { inputDir: string; outputDir: string; sources: { inputDir: string; outputDir: string } } };
      expect(response.status).toBe(200);
      expect(json.data).toMatchObject({
        inputDir: chosenInputDir,
        outputDir: chosenOutputDir,
        sources: { inputDir: "saved", outputDir: "saved" },
      });

      response = await fetch(`${baseUrl}/api/etsy-agent/folder-settings`);
      json = await response.json() as { ok: boolean; data: { inputDir: string; outputDir: string; sources: { inputDir: string; outputDir: string } } };
      expect(response.status).toBe(200);
      expect(json.data).toMatchObject({
        inputDir: chosenInputDir,
        outputDir: chosenOutputDir,
        sources: { inputDir: "saved", outputDir: "saved" },
      });
    });
  });

  it("rejects invalid image input or output folder settings", async () => {
    const tmp = setupEnv();
    const validInputDir = path.join(tmp, "valid-input");
    const validOutputDir = path.join(tmp, "valid-output");
    fs.mkdirSync(validInputDir, { recursive: true });
    fs.mkdirSync(validOutputDir, { recursive: true });
    process.env.IMAGE_AGENT_INPUT_DIR = validInputDir;
    process.env.IMAGE_AGENT_OUTPUT_DIR = validOutputDir;
    process.env.ETSY_AGENT_FOLDER_SETTINGS_PATH = path.join(tmp, "folder-settings.json");

    await withServer(async (baseUrl) => {
      let response = await fetch(`${baseUrl}/api/etsy-agent/folder-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputDir: path.join(tmp, "missing-input"), outputDir: validOutputDir }),
      });
      let json = await response.json() as { ok: boolean; code: string; error: string };
      expect(response.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.code).toBe("FOLDER_SETTINGS_INPUT_DIR_INVALID");

      response = await fetch(`${baseUrl}/api/etsy-agent/folder-settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputDir: validInputDir, outputDir: path.join(tmp, "missing-output") }),
      });
      json = await response.json() as { ok: boolean; code: string; error: string };
      expect(response.status).toBe(400);
      expect(json.ok).toBe(false);
      expect(json.code).toBe("FOLDER_SETTINGS_OUTPUT_DIR_INVALID");
    });
  });

  it("serves input asset previews for Chinese file names without unsafe response headers", async () => {
    const tmp = setupEnv();
    const inputDir = path.join(tmp, "图片输入");
    const outputDir = path.join(tmp, "图片输出");
    fs.mkdirSync(inputDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });
    process.env.IMAGE_AGENT_INPUT_DIR = inputDir;
    process.env.IMAGE_AGENT_OUTPUT_DIR = outputDir;
    process.env.ETSY_AGENT_DATA_PATH = path.join(tmp, "data");
    process.env.ETSY_AGENT_STORAGE_PATH = path.join(tmp, "storage");
    process.env.ETSY_AGENT_INPUT_ASSETS_PATH = path.join(tmp, "data", "input-assets.json");
    process.env.ETSY_AGENT_PROMPT_RECORDS_PATH = path.join(tmp, "data", "prompt-records.json");
    const fileName = "微信图片_20260521151311.jpg";
    fs.writeFileSync(path.join(inputDir, fileName), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    await withServer(async (baseUrl) => {
      const scanResponse = await fetch(`${baseUrl}/api/etsy-agent/desktop-batch/scan`);
      const scanJson = await scanResponse.json() as { ok: boolean; data: { inputDir: string; outputDir: string; assets: Array<{ inputAssetId: string; fileName: string }> } };
      expect(scanResponse.status).toBe(200);
      expect(scanJson.data).toMatchObject({ inputDir, outputDir });
      expect(scanJson.data).not.toHaveProperty("promptDir");
      const asset = scanJson.data.assets.find((item) => item.fileName === fileName);
      expect(asset?.inputAssetId).toMatch(/^input_/);

      const preview = await fetch(`${baseUrl}/api/etsy-agent/input-assets/${encodeURIComponent(asset!.inputAssetId)}/image`);
      expect(preview.status).toBe(200);
      expect(preview.headers.get("content-type")).toContain("image/jpeg");
      expect(preview.headers.get("content-disposition")).toBeNull();
      expect((await preview.arrayBuffer()).byteLength).toBeGreaterThan(0);

      const missing = await fetch(`${baseUrl}/api/etsy-agent/input-assets/input_missing/image`);
      expect(missing.status).toBe(404);
    });
  });
});
