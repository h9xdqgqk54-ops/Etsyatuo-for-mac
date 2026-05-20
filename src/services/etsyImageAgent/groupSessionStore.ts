import * as fs from "node:fs";
import * as path from "node:path";
import { etsyAgentConfig } from "./config.js";
import type { GroupSession, ProductGroup } from "./types.js";
import { ensureDir, makeId, nowIso } from "./utils.js";

const metadataDir = path.join(etsyAgentConfig.storageRoot, "metadata");
const sessionsFile = path.join(metadataDir, "group-sessions.json");

export function saveGroupSession(sessionId: string, groups: ProductGroup[], images = groups.flatMap((group) => group.images)): GroupSession {
  const sessions = listGroupSessions();
  const now = nowIso();
  const normalizedGroups = groups.map(normalizeGroup);
  const existing = sessions.find((session) => session.sessionId === sessionId);
  const session: GroupSession = {
    sessionId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    groups: normalizedGroups,
    images,
  };
  const next = [session, ...sessions.filter((item) => item.sessionId !== sessionId)].slice(0, 100);
  writeJson(sessionsFile, next);
  return session;
}

export function listGroupSessions(): GroupSession[] {
  return readJson<GroupSession[]>(sessionsFile, []);
}

export function findGroupSession(sessionId: string): GroupSession | undefined {
  return listGroupSessions().find((session) => session.sessionId === sessionId);
}

export function renameGroup(sessionId: string, groupId: string, displayName: string, sku?: string): GroupSession {
  return updateGroupSession(sessionId, (groups) => {
    const group = requireGroup(groups, groupId);
    group.displayName = displayName.trim() || group.displayName;
    if (typeof sku === "string") group.sku = sku.trim() || undefined;
  });
}

export function setGroupMainImage(sessionId: string, groupId: string, imageId: string): GroupSession {
  return updateGroupSession(sessionId, (groups) => {
    const group = requireGroup(groups, groupId);
    if (!group.images.some((image) => image.id === imageId)) throw new Error("图片不属于该商品组。");
    group.mainImageId = imageId;
  });
}

export function moveImageBetweenGroups(sessionId: string, imageId: string, fromGroupId: string, toGroupId: string): GroupSession {
  return updateGroupSession(sessionId, (groups) => {
    const from = requireGroup(groups, fromGroupId);
    const to = requireGroup(groups, toGroupId);
    const image = from.images.find((item) => item.id === imageId);
    if (!image) throw new Error("待移动图片不存在。");
    from.images = from.images.filter((item) => item.id !== imageId);
    to.images.push(image);
    refreshGroupDerivedFields(from);
    refreshGroupDerivedFields(to);
  });
}

export function mergeGroups(sessionId: string, sourceGroupIds: string[], targetName?: string): GroupSession {
  const uniqueIds = Array.from(new Set(sourceGroupIds.filter(Boolean)));
  if (uniqueIds.length < 2) throw new Error("至少选择两个商品组才能合并。");
  return updateGroupSession(sessionId, (groups) => {
    const selected = uniqueIds.map((id) => requireGroup(groups, id));
    const merged: ProductGroup = normalizeGroup({
      ...selected[0]!,
      id: makeId("group"),
      displayName: targetName?.trim() || selected.map((group) => group.displayName).join(" + "),
      images: selected.flatMap((group) => group.images),
      confidence: Math.min(...selected.map((group) => group.confidence), 0.7),
      confidenceLabel: "medium",
      reason: "用户手动合并的商品组。",
      locked: selected.some((group) => group.locked),
    });
    groups.splice(0, groups.length, merged, ...groups.filter((group) => !uniqueIds.includes(group.id)));
  });
}

export function splitGroup(sessionId: string, groupId: string, imageIds: string[], newGroupName?: string): GroupSession {
  const selectedIds = Array.from(new Set(imageIds.filter(Boolean)));
  if (selectedIds.length === 0) throw new Error("请选择要拆分的图片。");
  return updateGroupSession(sessionId, (groups) => {
    const group = requireGroup(groups, groupId);
    const moved = group.images.filter((image) => selectedIds.includes(image.id));
    if (moved.length === 0) throw new Error("待拆分图片不存在。");
    if (moved.length >= group.images.length) throw new Error("不能把商品组内所有图片拆出。");
    group.images = group.images.filter((image) => !selectedIds.includes(image.id));
    refreshGroupDerivedFields(group);
    const split: ProductGroup = normalizeGroup({
      id: makeId("group"),
      displayName: newGroupName?.trim() || `${group.displayName} - 拆分`,
      confidence: 0.45,
      confidenceLabel: "low",
      reason: "用户手动拆分的商品组，请在生成前确认。",
      images: moved,
      originalFileNames: moved.map((image) => image.originalFileName),
      mainImageId: moved[0]?.id,
      locked: false,
    });
    groups.push(split);
  });
}

export function setGroupLocked(sessionId: string, groupId: string, locked: boolean): GroupSession {
  return updateGroupSession(sessionId, (groups) => {
    const group = requireGroup(groups, groupId);
    group.locked = locked;
  });
}

function updateGroupSession(sessionId: string, edit: (groups: ProductGroup[]) => void): GroupSession {
  const session = findGroupSession(sessionId);
  if (!session) throw new Error("商品分组会话不存在或已过期。");
  const groups = session.groups.map((group) => ({ ...group, images: [...group.images], originalFileNames: [...group.originalFileNames] }));
  edit(groups);
  return saveGroupSession(sessionId, groups, groups.flatMap((group) => group.images));
}

function normalizeGroup(group: ProductGroup): ProductGroup {
  const normalized = { ...group, images: [...group.images] };
  if (!normalized.mainImageId || !normalized.images.some((image) => image.id === normalized.mainImageId)) {
    normalized.mainImageId = normalized.images[0]?.id;
  }
  refreshGroupDerivedFields(normalized);
  return normalized;
}

function refreshGroupDerivedFields(group: ProductGroup): void {
  group.originalFileNames = group.images.map((image) => image.originalFileName);
  if (!group.mainImageId || !group.images.some((image) => image.id === group.mainImageId)) {
    group.mainImageId = group.images[0]?.id;
  }
  if (group.images.length <= 1 && group.confidenceLabel !== "low") {
    group.confidenceLabel = "low";
    group.confidence = Math.min(group.confidence, 0.49);
  }
}

function requireGroup(groups: ProductGroup[], groupId: string): ProductGroup {
  const group = groups.find((item) => item.id === groupId);
  if (!group) throw new Error("商品组不存在。");
  return group;
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}
