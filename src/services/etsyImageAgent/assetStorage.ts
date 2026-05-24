import * as fs from "node:fs";
import * as path from "node:path";
import { etsyAgentConfig, publicUrlForStoragePath } from "./config.js";
import { ensureDir } from "./utils.js";

export type AssetStorageProvider = "local" | "vercel-blob";

export interface StoredAsset {
  storedPath: string;
  publicUrl: string;
}

export interface AssetStorage {
  provider: AssetStorageProvider;
  saveOriginal(input: {
    data: Buffer;
    localPath: string;
    contentType: string;
    blobPath: string;
  }): Promise<StoredAsset>;
  publicUrlForLocalPath(filePath: string): string;
}

export function selectedAssetStorageProvider(): AssetStorageProvider {
  return etsyAgentConfig.storageProvider === "vercel-blob" ? "vercel-blob" : "local";
}

export function getAssetStorage(): AssetStorage {
  return selectedAssetStorageProvider() === "vercel-blob" ? vercelBlobStorage : localStorage;
}

const localStorage: AssetStorage = {
  provider: "local",
  async saveOriginal(input) {
    ensureDir(path.dirname(input.localPath));
    await fs.promises.writeFile(input.localPath, input.data);
    return {
      storedPath: input.localPath,
      publicUrl: publicUrlForStoragePath(input.localPath),
    };
  },
  publicUrlForLocalPath(filePath) {
    return publicUrlForStoragePath(filePath);
  },
};

const vercelBlobStorage: AssetStorage = {
  provider: "vercel-blob",
  async saveOriginal(input) {
    ensureDir(path.dirname(input.localPath));
    await fs.promises.writeFile(input.localPath, input.data);
    const { put } = await import("@vercel/blob");
    const blob = await put(input.blobPath, input.data, {
      access: "public",
      contentType: input.contentType,
      addRandomSuffix: true,
    });
    if (!isPublicHttpsUrl(blob.url)) {
      throw new Error("PUBLIC_ASSET_STORAGE_REQUIRED：Vercel Blob 上传未返回公网 HTTPS publicUrl，不能执行公网参考图生成。");
    }
    return {
      storedPath: input.localPath,
      publicUrl: blob.url,
    };
  },
  publicUrlForLocalPath(filePath) {
    return publicUrlForStoragePath(filePath);
  },
};

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}
