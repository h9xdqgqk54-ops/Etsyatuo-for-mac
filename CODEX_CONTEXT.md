# Etsyauto Codex 上下文

## 当前项目
项目名称：Etsyauto
当前目录：/Users/gongzeyuan/Desktop/自动化文件夹/Etsyauto

## 当前目标
把此前实现的 Etsy 图片 Agent 并入选品 / EAST 货源工作流中的“AI 内容生成 → 图片生成”部分。

但在并入前，必须先完成图片生成 Provider 的配置修复：

1. 豆包 / 火山方舟 Seedream 和 OpenAI Image 是二选一接入。
2. 用户选择 doubao 时，只需要 ARK_API_KEY，不应该要求 OPENAI_API_KEY。
3. 用户选择 openai 时，只需要 OPENAI_API_KEY，不应该要求 ARK_API_KEY。
4. 用户选择 mock 时，不需要任何真实 API key。
5. EAST / 货源工作流推理 API 是另一套独立配置，不能和图片生成 API 混用。

## 当前已知问题

### 1. 豆包模型 ID 错误
真实生成时曾报错：

InvalidEndpointOrModel.NotFound
The model or endpoint doubao-seedream-5-0-lite-250428 does not exist or you do not have access to it.

原因：
当前代码默认模型 ID 使用了旧值：
doubao-seedream-5-0-lite-250428

需要改为：
doubao-seedream-5-0-lite-260128

同时允许用户通过 .env 覆盖：
DOUBAO_SEEDREAM_MODEL=用户控制台实际开通的模型ID

### 2. .env 中之前没有 DOUBAO_SEEDREAM_MODEL
用户执行：
grep -n "DOUBAO_SEEDREAM_MODEL" .env

没有输出，说明 .env 没有该变量，系统回退到了代码默认值。

### 3. 真实生成开关问题
之前出现过：
真实图片生成未启用。请设置 IMAGE_AGENT_ENABLE_REAL_GENERATION=true。

需要确认后端优先读取：
IMAGE_AGENT_ENABLE_REAL_GENERATION

并兼容旧变量：
ETSY_AGENT_ENABLE_REAL_GENERATION

### 4. 中文文件名乱码
上传图片后，商品组名称显示为乱码，例如：
å ¾ç...

需要修复 uploadParser / 前端展示：
- 中文文件名应按 UTF-8 正确显示；
- 如果无法恢复原名，使用 uploaded-image-1 / product-1 作为 displayName；
- 不要让乱码进入 prompt。

## 图片 Provider 目标设计

统一使用：

IMAGE_AGENT_PROVIDER=mock | doubao | openai

豆包配置，仅当 IMAGE_AGENT_PROVIDER=doubao 时需要：
ARK_API_KEY
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
DOUBAO_SEEDREAM_MODEL=doubao-seedream-5-0-lite-260128

OpenAI 配置，仅当 IMAGE_AGENT_PROVIDER=openai 时需要：
OPENAI_API_KEY
OPENAI_IMAGE_MODEL=gpt-image-2

通用开关：
IMAGE_AGENT_MOCK_MODE=false
IMAGE_AGENT_ENABLE_REAL_GENERATION=true
IMAGE_AGENT_ALLOW_WEB_KEY_CONFIG=false

兼容旧变量：
ETSY_AGENT_IMAGE_PROVIDER => IMAGE_AGENT_PROVIDER
ETSY_AGENT_MOCK_OPENAI => IMAGE_AGENT_MOCK_MODE
ETSY_AGENT_ENABLE_REAL_GENERATION => IMAGE_AGENT_ENABLE_REAL_GENERATION
ETSY_AGENT_ALLOW_WEB_KEY_CONFIG => IMAGE_AGENT_ALLOW_WEB_KEY_CONFIG

## Provider 检查规则

当 selectedProvider=doubao：
- 只检查 ARK_API_KEY；
- 不检查 OPENAI_API_KEY；
- 如果缺 key，只返回 ARK_API_KEY_MISSING；
- 不返回 OPENAI_API_KEY_MISSING。

当 selectedProvider=openai：
- 只检查 OPENAI_API_KEY；
- 不检查 ARK_API_KEY；
- 如果缺 key，只返回 OPENAI_API_KEY_MISSING；
- 不返回 ARK_API_KEY_MISSING。

当 selectedProvider=mock：
- 不要求任何真实 key；
- 不返回 key missing 阻断错误。

## EAST 工作流边界

EAST / 货源 / 选品推理工作流使用另一套 API：

EAST_REASONING_API_KEY
EAST_REASONING_BASE_URL
EAST_REASONING_MODEL
EAST_REASONING_PROVIDER=east

严格要求：
- 图片生成不得使用 EAST_REASONING_API_KEY。
- EAST 推理不得使用 ARK_API_KEY 或 OPENAI_API_KEY。
- ARK_API_KEY 只用于豆包图片生成。
- OPENAI_API_KEY 只用于 OpenAI Image 图片生成。

## 当前需要 Codex 完成的任务

1. 修复图片 Provider 二选一配置逻辑。
2. 更新默认豆包模型 ID 为 doubao-seedream-5-0-lite-260128。
3. Provider 设置页显示当前 selectedProvider、模型 ID、key configured/missing、realGenerationEnabled、mockMode。
4. 任务创建只检查 selectedProvider 对应的 key。
5. InvalidEndpointOrModel.NotFound 返回用户可读错误，不要只显示原始 JSON。
6. 修复中文文件名乱码或使用安全 displayName fallback。
7. 更新 README.md、DESIGN.md、.env.example。
8. 增加测试：
   - doubao 模式不要求 OPENAI_API_KEY；
   - openai 模式不要求 ARK_API_KEY；
   - mock 模式不要求 key；
   - 默认 DOUBAO_SEEDREAM_MODEL 是 doubao-seedream-5-0-lite-260128；
   - .env 覆盖 DOUBAO_SEEDREAM_MODEL 生效；
   - 错误响应和日志不包含完整 API key；
   - 中文文件名不会进入 prompt 乱码。
9. 跑：
   pnpm typecheck
   pnpm test
   pnpm build
   pnpm verify:local

## 安全要求

不要提交或写入任何真实 API key。
不要把 key 写入前端代码、localStorage、sessionStorage、README、测试快照或日志。
所有 API 响应只能返回 maskedKey / fingerprint。
