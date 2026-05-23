# Etsyauto 图片 Agent Design

## Product Shape

`/etsy-image-agent` 是主工作台。当前流程是：

1. 扫描 `IMAGE_AGENT_INPUT_DIR` 中的图片并登记为 `InputAssetRecord`。
2. GPT5.5 视觉模型读取每张已登记图片，生成 `ImagePromptRecord`。
3. 人工编辑/通过 prompt。
4. OpenAI Images edit 使用同一 `inputAssetId` 的本地图片和 prompt 快照生成候选图。
5. 人工通过后复制到 `IMAGE_AGENT_OUTPUT_DIR`，并清理候选素材。

`/asset-library` 和 `/settings/openai` 是子页面。旧上传分组、公网参考图、Cloudflare 和非 OpenAI 图生图流程不属于本轮活跃流程。

## Provider Boundaries

GPT5.5 Prompt Provider 只做图片理解、prompt generation、款式名和 listing 文案：

- `GPT55_API_KEY`
- `GPT55_BASE_URL`
- `GPT55_MODEL`
- `GPT55_MAX_INPUT_MB`
- `GPT55_BATCH_LIMIT`

`GPT55_BASE_URL` 默认是 `https://allin-api.com/v1`，`GPT55_MODEL` 默认是 `gpt-5.5`。Provider 使用 OpenAI-compatible chat completions，请求里用 `data:image/...;base64,...` 传入本地图片，但 base64 不写日志、不落盘。

`/settings/openai` 的 Provider 设置页允许用户填写 GPT5.5 Prompt Provider 配置。浏览器不直接请求模型 API，而是把配置提交给本地后端；后端只保存到服务进程 session memory。有效的 `.env` key 保持优先，删除网页 GPT5.5 key 只清除 session key，不影响环境变量 key；`GPT55_BASE_URL` 和 `GPT55_MODEL` 保存后立即作为当前服务进程的 active 配置。测试 GPT5.5 配置只做诊断，不阻断自动 prompt generation。

Prompt generation 前只强制检查 active GPT5.5 配置是否有 key 和 model。缺 key、模型不可访问、权限不足、文本模型不支持图片输入等都作为全局配置错误返回，不写入单图 failed record。只有图片过大、MIME 不支持、单张返回坏 JSON 等图片级问题才保存为单图 failed。

OpenAI Image Provider 只做最终图生图：

- `OPENAI_API_KEY`
- `OPENAI_IMAGE_MODEL=gpt-image-2`
- `OPENAI_IMAGE_SIZE`
- `OPENAI_IMAGE_QUALITY`

OpenAI 请求继续使用非流式 `images.edit`，输入本地图片文件流和 prompt 快照。它不读取 GPT5.5 key，也不会 fallback 到 GPT5.5 文本/视觉接口。

EAST 推理只属于货源/选品工作流，`EAST_REASONING_API_KEY` 不参与图片理解或图生图。

## Data Rules

`InputAssetRecord` 按输入目录中的图片生成稳定 `inputAssetId`，记录安全本地路径、mime、大小、hash 和缩略图 URL。前端只传 `inputAssetId`，后端禁止读取任意本机路径。

`ImagePromptRecord` 落盘保存到 `data/etsy-agent/prompt-records.json`，绑定 `inputAssetId`，包含 role、detectedProduct、promptText、negativePrompt、source、status、confidence、model、promptHash 和时间戳。重启服务后 generated/edited/approved 记录不丢失。

批量 prompt generation 默认只处理缺失 prompt 的图片；重新生成全部跳过 `edited` / `approved`；单张覆盖 `edited` / `approved` 必须确认。

空 prompt 的旧配置类 failed record 会在扫描、读取 prompt 或保存 Provider 配置时清理/忽略，避免旧 endpoint 错误把单张卡片卡死。缺失 prompt 卡片允许用户手动填写并保存为 `edited`，然后继续 OpenAI 生图。

OpenAI job 和 asset 必须保存 `promptRecordId`、`promptTextSnapshot`、`negativePromptSnapshot`、`promptHash`、`inputAssetId`、`promptStatusAtGeneration`。实际生图使用 snapshot，避免后续人工改 prompt 影响已创建 job。

## Security

商品工作台的价格按批次内每个款式/尺寸行维护。人工输入人民币进货价、货类、包装、重量和尺寸后，后端按截图规则估算运费并用 `(人民币进货价 + 运费) * 5` 计算 USD/GBP；确认价格只保存行状态并导出 CSV/JSON 映射，不重命名输入图或输出图。

API 响应只暴露 configured、maskedKey、fingerprint、模型名和非敏感配置。不得返回或记录 `GPT55_API_KEY`、`OPENAI_API_KEY`、`EAST_REASONING_API_KEY` 明文。不得把 key 写入 localStorage、sessionStorage、README、DESIGN、测试快照或前端源码。

日志不记录图片 base64。`.env` 不提交。`.env.example` 只包含占位符。
