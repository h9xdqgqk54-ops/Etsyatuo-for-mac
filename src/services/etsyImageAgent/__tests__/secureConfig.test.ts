import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("secureConfig", () => {
  it("allows web key save by default for local server memory only", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-secure-"));
    process.env.ETSY_AGENT_CONFIG_PATH = path.join(tmp, "secure-config.json");
    process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(tmp, "security.log");
    const mod = await import("../secureConfig.js");
    const status = mod.saveLocalOpenAIKey("sk-test_abcdefghijklmnopqrstuvwxyz");
    expect(status.configured).toBe(true);
    expect(status.source).toBe("session");
    expect(fs.existsSync(path.join(tmp, "secure-config.json"))).toBe(false);
  });

  it("does not allow web key save on Vercel unless explicitly enabled", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-secure-"));
    process.env.ETSY_AGENT_CONFIG_PATH = path.join(tmp, "secure-config.json");
    process.env.IMAGE_AGENT_ALLOW_WEB_KEY_CONFIG = "false";
    process.env.VERCEL = "1";
    const mod = await import("../secureConfig.js");
    expect(() => mod.saveLocalOpenAIKey("sk-test_abcdefghijklmnopqrstuvwxyz")).toThrow(/未启用/);
  });

  it("saves an OpenAI web key in session memory without returning plaintext", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-secure-"));
    process.env.ETSY_AGENT_CONFIG_PATH = path.join(tmp, "secure-config.json");
    process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(tmp, "security.log");
    process.env.IMAGE_AGENT_ALLOW_WEB_KEY_CONFIG = "true";
    process.env.OPENAI_API_KEY = "";
    const mod = await import("../secureConfig.js");
    const plaintext = "sk-test_abcdefghijklmnopqrstuvwxyz";
    const status = mod.saveLocalOpenAIKey(plaintext);
    expect(status.selectedProvider).toBe("openai");
    expect(status.configured).toBe(true);
    expect(status.source).toBe("session");
    expect(status.maskedKey).toMatch(/^sk-tes\.\.\./);
    expect(JSON.stringify(status)).not.toContain(plaintext);
    expect(JSON.stringify(status)).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(fs.existsSync(path.join(tmp, "secure-config.json"))).toBe(false);
    const log = fs.readFileSync(path.join(tmp, "security.log"), "utf-8");
    expect(log).not.toContain(plaintext);
    expect(log).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(log).toContain("openai_key_saved");
  });

  it("saves OpenAI Base URL in session memory and normalizes it", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-secure-"));
    process.env.ETSY_AGENT_CONFIG_PATH = path.join(tmp, "secure-config.json");
    process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(tmp, "security.log");
    process.env.OPENAI_BASE_URL = "";
    process.env.OPENAI_IMAGE_INPUT_FIDELITY = "";
    const mod = await import("../secureConfig.js");
    const status = mod.saveLocalOpenAIBaseURL("https://relay.example.test/v1/");
    expect(status.baseURL).toBe("https://relay.example.test/v1");
    expect(status.baseURLSource).toBe("session");
    expect(status.providersById.openai.baseURL).toBe("https://relay.example.test/v1");
    expect(fs.existsSync(path.join(tmp, "secure-config.json"))).toBe(false);

    const reset = mod.saveLocalOpenAIBaseURL("");
    expect(reset.baseURL).toBe("");
    expect(reset.baseURLSource).toBe("default");
  });

  it("saves OpenAI input fidelity in session memory and defaults to off", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-secure-"));
    process.env.ETSY_AGENT_CONFIG_PATH = path.join(tmp, "secure-config.json");
    process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(tmp, "security.log");
    process.env.OPENAI_IMAGE_INPUT_FIDELITY = "";
    const mod = await import("../secureConfig.js");
    const initial = mod.publicOpenAISettingsStatus();
    expect(initial.inputFidelity).toBe("off");
    expect(initial.inputFidelitySource).toBe("default");
    const high = mod.saveLocalOpenAIInputFidelity("high");
    expect(high.inputFidelity).toBe("high");
    expect(high.inputFidelitySource).toBe("session");
    expect(high.providersById.openai.inputFidelity).toBe("high");
    expect(fs.existsSync(path.join(tmp, "secure-config.json"))).toBe(false);
    const off = mod.saveLocalOpenAIInputFidelity("off");
    expect(off.inputFidelity).toBe("off");
    expect(off.inputFidelitySource).toBe("session");
    expect(() => mod.saveLocalOpenAIInputFidelity("ultra")).toThrow(/off、low 或 high/);
  });

  it("rejects unsafe OpenAI Base URLs", async () => {
    const mod = await import("../secureConfig.js");
    expect(() => mod.saveLocalOpenAIBaseURL("file:///tmp/openai")).toThrow(/http/);
    expect(() => mod.saveLocalOpenAIBaseURL("https://user:pass@relay.example.test/v1")).toThrow(/用户名或密码/);
    expect(() => mod.saveLocalOpenAIBaseURL("https://relay.example.test/v1?key=x")).toThrow(/query/);
  });

  it("deletes session key when enabled and no env key is present", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-secure-"));
    process.env.ETSY_AGENT_CONFIG_PATH = path.join(tmp, "secure-config.json");
    process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(tmp, "security.log");
    process.env.IMAGE_AGENT_ALLOW_WEB_KEY_CONFIG = "true";
    process.env.OPENAI_API_KEY = "";
    const mod = await import("../secureConfig.js");
    mod.saveLocalOpenAIKey("sk-test_abcdefghijklmnopqrstuvwxyz");
    const status = mod.deleteLocalOpenAIKey();
    expect(status.configured).toBe(false);
    expect(status.source).toBe("not_configured");
  });

  it("never treats non-OpenAI provider env values as selected providers", async () => {
    process.env.IMAGE_AGENT_PROVIDER = "legacy-provider";
    process.env.IMAGE_AGENT_MOCK_MODE = "true";
    process.env.OPENAI_API_KEY = "";
    const mod = await import("../secureConfig.js");
    const config = mod.getImageProviderConfig();
    expect(config.selectedProvider).toBe("openai");
    expect(config.mockMode).toBe(false);
    expect(Object.keys(config.providers)).toEqual(["openai"]);
    expect(config.diagnostics).toEqual(["OPENAI_API_KEY_MISSING"]);
  });

  it("does not treat the documented placeholder OpenAI key as configured", async () => {
    process.env.OPENAI_API_KEY = "your_openai_key_here";
    const mod = await import("../secureConfig.js");
    const status = mod.publicOpenAISettingsStatus();
    expect(status.configured).toBe(false);
    expect(status.source).toBe("not_configured");
    expect(status.maskedKey).toBe("");
    expect(status.imageProviderConfig.diagnostics).toEqual(["OPENAI_API_KEY_MISSING"]);
  });

  it("redacts keys embedded inside security log detail strings", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-secure-"));
    process.env.ETSY_AGENT_SECURITY_LOG_PATH = path.join(tmp, "security.log");
    const mod = await import("../secureConfig.js");
    const plaintext = "sk-test_abcdefghijklmnopqrstuvwxyz";
    mod.appendSecurityEvent("test_error", { message: `failed with ${plaintext}` });
    const log = fs.readFileSync(path.join(tmp, "security.log"), "utf-8");
    expect(log).not.toContain(plaintext);
    expect(log).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(log).toContain("sk-tes...");
  });
});
