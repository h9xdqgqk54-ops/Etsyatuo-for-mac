import { execFileSync } from "node:child_process";
import { fetch as undiciFetch, ProxyAgent } from "undici";

let cachedProxyUrl: string | null | undefined;
let cachedProxyAgent: ProxyAgent | undefined;
let cachedProxyFetch: typeof fetch | undefined;

export function openAIFetch(): typeof fetch | undefined {
  const proxyUrl = resolveOpenAIProxyUrl();
  if (!proxyUrl) return undefined;
  if (cachedProxyFetch) return cachedProxyFetch;
  if (!cachedProxyAgent) {
    cachedProxyAgent = new ProxyAgent(proxyUrl);
  }
  cachedProxyFetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    return undiciFetch(input as never, { ...(init ?? {}), dispatcher: cachedProxyAgent } as never) as never;
  }) as typeof fetch;
  return cachedProxyFetch;
}

export function openAIProxyStatus(): { configured: boolean; source: "env" | "macos-system" | "none"; proxyUrl?: string } {
  const envProxy = proxyFromEnv();
  if (envProxy) return { configured: true, source: "env", proxyUrl: redactProxyUrl(envProxy) };
  const systemProxy = proxyFromMacOSSystem();
  if (systemProxy) return { configured: true, source: "macos-system", proxyUrl: redactProxyUrl(systemProxy) };
  return { configured: false, source: "none" };
}

function resolveOpenAIProxyUrl(): string | null {
  if (cachedProxyUrl !== undefined) return cachedProxyUrl;
  cachedProxyUrl = proxyFromEnv() ?? proxyFromMacOSSystem();
  return cachedProxyUrl;
}

function proxyFromEnv(): string | null {
  const raw = process.env.OPENAI_PROXY_URL || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  return normalizeProxyUrl(raw);
}

function proxyFromMacOSSystem(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const output = execFileSync("scutil", ["--proxy"], { encoding: "utf-8", timeout: 1_000 });
    const parsed = Object.fromEntries(output
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Za-z]+)\s+:\s+(.+?)\s*$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1]!, match[2]!] as const));
    if (parsed.HTTPSEnable === "1" && parsed.HTTPSProxy && parsed.HTTPSPort) {
      return normalizeProxyUrl(`http://${parsed.HTTPSProxy}:${parsed.HTTPSPort}`);
    }
    if (parsed.HTTPEnable === "1" && parsed.HTTPProxy && parsed.HTTPPort) {
      return normalizeProxyUrl(`http://${parsed.HTTPProxy}:${parsed.HTTPPort}`);
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeProxyUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `http://${value}`;
}

function redactProxyUrl(value: string): string {
  return value.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:[redacted]@");
}
