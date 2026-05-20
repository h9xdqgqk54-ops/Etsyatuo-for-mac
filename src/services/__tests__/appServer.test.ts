import * as http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createEtsyautoServer } from "../app_server.js";

let server: http.Server | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
});

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  server = createEtsyautoServer();
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return fn(`http://127.0.0.1:${port}`);
}

describe("app server static routes", () => {
  it("serves HEAD / for local and tunnel health checks", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/`, { method: "HEAD" });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0);
    });
  });
});
