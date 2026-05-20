import { findTask, listTasks } from "./assetLibrary.js";
import type { CreateTaskInput, EtsyAgentTask } from "./types.js";

const LEGACY_TASK_FLOW_REMOVED = "LEGACY_TASK_FLOW_REMOVED：当前图片 Agent 使用桌面批量 OpenAI 图生图，请调用 /api/etsy-agent/desktop-batch。";

function legacyTaskFlowRemoved(): Error {
  return new Error(LEGACY_TASK_FLOW_REMOVED);
}

export function createEtsyAgentTask(_input: CreateTaskInput): EtsyAgentTask {
  throw legacyTaskFlowRemoved();
}

export function enqueueTask(_taskId: string): void {
  throw legacyTaskFlowRemoved();
}

export function retryTask(_taskId: string, _enqueue = true): EtsyAgentTask {
  throw legacyTaskFlowRemoved();
}

export function cancelTask(_taskId: string): EtsyAgentTask {
  throw legacyTaskFlowRemoved();
}

export function retryTaskProduct(_taskId: string, _productGroupId: string): EtsyAgentTask {
  throw legacyTaskFlowRemoved();
}

export function regenerateAsset(_assetId: string): EtsyAgentTask {
  throw legacyTaskFlowRemoved();
}

export function getTask(taskId: string): EtsyAgentTask | undefined {
  return findTask(taskId);
}

export function getTasks(): EtsyAgentTask[] {
  return listTasks();
}
