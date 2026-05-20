# Etsyauto 图片 Agent

`/etsy-image-agent` 是当前主工作台：它读取桌面固定文件夹中的图片和提示词，用 OpenAI Images edit 批量生成候选图，再由人工逐张质检。

## 本地文件夹

应用只读取三个固定目录，不接受网页传入任意本机路径：

- `~/Desktop/图片输入`
- `~/Desktop/提示词输入`
- `~/Desktop/图片输出`

图片支持 `jpg`、`jpeg`、`png`、`webp`。提示词文件必须是 `.txt`。系统按同名 basename 配对，例如 `001.jpg` 对 `001.txt`。缺图、缺提示词、重复 basename、空提示词都会在调用 OpenAI 前失败。

## OpenAI 配置

推荐先用 1 张、`low` quality、`1024x1024` 跑通：

```env
IMAGE_AGENT_PROVIDER=openai
OPENAI_API_KEY=your_openai_key_here
OPENAI_BASE_URL=
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_IMAGE_SIZE=1024x1024
OPENAI_IMAGE_QUALITY=low
OPENAI_IMAGE_INPUT_FIDELITY=off
OPENAI_IMAGE_MAX_INPUT_MB=20
IMAGE_AGENT_ENABLE_REAL_GENERATION=true
IMAGE_AGENT_ALLOW_WEB_KEY_CONFIG=true
```

OpenAI 模式不需要 `IMAGE_AGENT_PUBLIC_BASE_URL`，不需要 cloudflared/ngrok，不需要 `ARK_API_KEY`。`gpt-image-2` 可能需要账号、组织验证、模型权限或额度；失败时应用会返回结构化错误，不自动 fallback 到其他模型，也不会伪造成功。

如需使用 OpenAI 兼容中转站，可设置 `OPENAI_BASE_URL`，或在 `/settings/openai` 的 Base URL 输入框临时保存，例如 `https://api.openai.com/v1` 或你的中转站 `/v1` 地址。

`OPENAI_IMAGE_INPUT_FIDELITY` 默认 `off`，表示不向 OpenAI Images edit 请求发送可选的 `input_fidelity` 参数。部分中转站或模型会拒绝这个参数；只有确认当前模型/中转站支持时，才在 `/settings/openai` 或 `.env` 中改成 `low` / `high`。

OpenAI 图生图默认使用非流式 `images.edit`，只发送必要参数以提高中转站兼容性。GPT Image 正常应返回 base64 图片；如果中转站返回可下载图片 URL，应用会下载并保存到本地候选素材。如果接口返回成功但没有 base64 或可下载 URL，应用会报 `OPENAI_IMAGE_EMPTY_RESPONSE`，这通常表示该中转站没有完整支持 OpenAI Images edit。

本地开发时 `/settings/openai` 可以把 OpenAI key、Base URL 和 Input fidelity 保存到当前服务进程内存，适合临时验证；key 不会写入 `.env`、`secure-config.json`、`localStorage` 或 `sessionStorage`，重启服务后会丢失。长期使用仍推荐写入 `.env`。

## 工作流

1. 打开 `/etsy-image-agent`，点击“扫描文件夹”确认配对。
2. 点击“读取并生成”，系统为每个配对调用 OpenAI `images.edit`，输入本地图片文件和对应提示词。
3. 生成结果先保存为素材库候选图，关闭程序后再打开仍可看到未审查候选。
4. 点击“过关”会复制到 `~/Desktop/图片输出/{baseName}.png`，如重名则使用 `{baseName}-2.png`，随后删除候选素材记录和生成残留。
5. 点击“重新生成”会删除旧候选，并只为该条重新调用 OpenAI。
6. 开始下一批会自动清理上一批未审查候选，不删除“图片输出”里的最终文件。

## 页面

- `/etsy-image-agent`：主工作台，桌面批量生成和人工质检。
- `/asset-library`：待审查候选素材库。
- `/settings/openai`：OpenAI Provider 状态和可选的服务进程内 session key 配置。

网页不会把 OpenAI key 写入 `localStorage`、`sessionStorage`、前端源码或测试快照。API 响应只返回 `configured`、`maskedKey`、`fingerprint` 等脱敏状态。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm verify:local
```
