import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("OpenAI-only desktop batch UI", () => {
  it("uses the desktop batch workflow as the image agent main page", () => {
    const html = fs.readFileSync(path.resolve("public/etsy-image-agent.html"), "utf-8");
    expect(html).toContain("桌面批量图生图");
    expect(html).toContain("图片输入");
    expect(html).toContain("提示词输入");
    expect(html).toContain("图片输出");
    expect(html).toContain("读取并生成");
    expect(html).toContain("过关");
    expect(html).toContain("重新生成");
    expect(html).toContain("OPENAI_IMAGE_EMPTY_RESPONSE");
    expect(html).toContain("stopPolling");
    expect(html).toContain("批次失败");
    expect(html).toContain("/api/etsy-agent/desktop-batch/start");
    expect(html).not.toContain("groupDrawer");
    expect(html).not.toContain("上传参考图");
    expect(html).not.toContain("确认分组");
    expect(html).not.toContain("生成素材</b>");
    expect(html).not.toContain("cloudflared");
    expect(html).not.toContain("NEED_PUBLIC_IMAGE_URL");
  });

  it("keeps OpenAI settings focused on OpenAI key and local image input", () => {
    const html = fs.readFileSync(path.resolve("public/openai-settings.html"), "utf-8");
    expect(html).toContain("OpenAI Image 接入");
    expect(html).toContain("OPENAI_API_KEY");
    expect(html).toContain("OPENAI_BASE_URL");
    expect(html).toContain("Base URL");
    expect(html).toContain("Public URL");
    expect(html).toContain("not required");
    expect(html).toContain("gpt-image-2");
    expect(html).not.toContain("保存豆包 Key");
    expect(html).not.toContain("cloudflared");
    expect(html).not.toContain("IMAGE_AGENT_PUBLIC_BASE_URL");
  });

  it("keeps the asset library as a pending-candidate child page", () => {
    const html = fs.readFileSync(path.resolve("public/asset-library.html"), "utf-8");
    expect(html).toContain("待审查候选素材");
    expect(html).toContain("OpenAI 设置");
    expect(html).not.toContain("重新生成选中素材");
  });
});
