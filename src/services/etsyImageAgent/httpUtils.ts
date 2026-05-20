const DEFAULT_FETCH_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_ERROR_TEXT_BYTES = 64 * 1024;

export async function fetchWithTimeout(url: string, init: RequestInit = {}, label = "HTTP 请求", timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: init.signal ?? controller.signal });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`${label}超时：超过 ${Math.round(timeoutMs / 1000)} 秒未返回。`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readResponseBufferLimited(response: Response, label = "响应", maxBytes = DEFAULT_MAX_RESPONSE_BYTES): Promise<Buffer> {
  const declared = contentLength(response);
  if (declared !== undefined && declared > maxBytes) {
    throw new Error(`${label}过大：Content-Length 超过 ${formatMb(maxBytes)}MB。`);
  }
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    assertWithinLimit(buffer.length, maxBytes, label);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label}过大：下载内容超过 ${formatMb(maxBytes)}MB。`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function readResponseTextLimited(response: Response, label = "响应", maxBytes = DEFAULT_MAX_ERROR_TEXT_BYTES): Promise<string> {
  const buffer = await readResponseBufferLimited(response, label, maxBytes);
  return buffer.toString("utf-8");
}

function contentLength(response: Response): number | undefined {
  const raw = response.headers?.get?.("content-length");
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function assertWithinLimit(size: number, maxBytes: number, label: string): void {
  if (size > maxBytes) throw new Error(`${label}过大：下载内容超过 ${formatMb(maxBytes)}MB。`);
}

function formatMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
