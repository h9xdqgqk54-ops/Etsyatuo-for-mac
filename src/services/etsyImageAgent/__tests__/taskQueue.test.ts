import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("legacy taskQueue removal", () => {
  it("rejects legacy task creation with a desktop batch workflow message", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-task-legacy-"));
    process.env.ETSY_AGENT_STORAGE_PATH = tmp;
    const { createEtsyAgentTask } = await import("../taskQueue.js");
    expect(() => createEtsyAgentTask({
      groups: [],
      userPrompt: "white background",
      perProductImageCount: 1,
    })).toThrow(/LEGACY_TASK_FLOW_REMOVED/);
  });

  it("keeps read-only legacy task lookup for old metadata", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "etsy-task-read-"));
    process.env.ETSY_AGENT_STORAGE_PATH = tmp;
    const { saveTask } = await import("../assetLibrary.js");
    const { getTask, getTasks } = await import("../taskQueue.js");
    const now = new Date(0).toISOString();
    saveTask({
      taskId: "task-old",
      status: "failed",
      progress: 0,
      currentStep: "legacy",
      createdAt: now,
      updatedAt: now,
      userPrompt: "legacy",
      templateId: "legacy",
      perProductImageCount: 1,
      totalProducts: 0,
      totalPlannedImages: 0,
      completedImages: 0,
      failedImages: 0,
      model: "legacy",
      products: [],
      jobs: [],
      groups: [],
      cost: { productCount: 0, referenceImageCount: 0, requestedImagesPerProduct: 0, plannedGeneratedImages: 0, estimatedOpenAICalls: 0, maxConcurrentGenerations: 0, note: "legacy" },
      events: [],
    });
    expect(getTask("task-old")?.taskId).toBe("task-old");
    expect(getTasks()).toHaveLength(1);
  });
});
