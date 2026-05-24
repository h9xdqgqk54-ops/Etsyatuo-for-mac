import * as http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createEtsyautoServer, listenEtsyautoServer } from "../app_server.js";

let server: http.Server | undefined;
let listeningServer: Awaited<ReturnType<typeof listenEtsyautoServer>> | undefined;

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
  if (listeningServer) {
    await listeningServer.close();
    listeningServer = undefined;
  }
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

  it("redirects user-facing legacy entry pages to the image agent workbench", async () => {
    await withServer(async (baseUrl) => {
      for (const path of ["/", "/app", "/app.html"]) {
        const response = await fetch(`${baseUrl}${path}`, {
          method: "GET",
          redirect: "manual",
        });

        expect(response.status).toBe(302);
        expect(response.headers.get("location")).toBe("/etsy-image-agent");
      }
    });
  });

  it("listens on a dynamic port and returns a close helper for CLI launchers", async () => {
    listeningServer = await listenEtsyautoServer({ host: "127.0.0.1", port: 0, log: false });

    expect(listeningServer.port).toBeGreaterThan(0);
    expect(listeningServer.host).toBe("127.0.0.1");
    expect(listeningServer.url).toBe(`http://127.0.0.1:${listeningServer.port}`);

    const response = await fetch(`${listeningServer.url}/etsy-image-agent`, { method: "HEAD" });
    expect(response.status).toBe(200);
  });

  it("serves extracted static assets for the production workbench", async () => {
    await withServer(async (baseUrl) => {
      const routes = [
        ["/etsy-image-agent.css", "text/css"],
        ["/etsy-image-agent.js", "application/javascript"],
        ["/openai-settings.css", "text/css"],
        ["/openai-settings.js", "application/javascript"],
      ] as const;

      for (const [route, contentType] of routes) {
        const response = await fetch(`${baseUrl}${route}`, { method: "HEAD" });
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(contentType);
        expect(Number(response.headers.get("content-length"))).toBeGreaterThan(0);
      }
    });
  });

  it("redirects the removed asset library page to the image agent workbench", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/asset-library`, {
        method: "GET",
        redirect: "manual",
      });

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/etsy-image-agent");
    });
  });

  it("returns 410 for removed legacy demo workflow API routes", async () => {
    await withServer(async (baseUrl) => {
      for (const route of ["/api/state", "/api/products", "/api/matches", "/api/generations"]) {
        const response = await fetch(`${baseUrl}${route}`);
        const body = await response.json() as { error?: string };

        expect(response.status).toBe(410);
        expect(body.error).toContain("LEGACY_WORKFLOW_REMOVED");
      }
    });
  });
});
