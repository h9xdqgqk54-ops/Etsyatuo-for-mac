# Etsyauto Codex Handoff

## 当前任务
继续修复 Etsyauto 项目里的豆包 / 火山方舟 product_reference 图生图问题。

不要处理 Vercel。
不要新建平级项目。
不要提交或写入真实 API key。
不要读取、打印、提交 .env 里的 ARK_API_KEY、OPENAI_API_KEY、EAST_REASONING_API_KEY。

## 当前项目路径
/Users/gongzeyuan/Desktop/自动化文件夹/Etsyauto

## 当前已知状态
1. 本地 media 图片可以访问：
   http://localhost:3456/media/... 返回 200 OK，Content-Type: image/jpeg

2. trycloudflare 公网图片 URL 返回：
   HTTP/2 530，Content-Type: text/html

3. 结论：
   Etsyauto 的 /media 路由和图片文件本身正常。
   问题在 Cloudflare Tunnel 公网地址回源失败，或 IMAGE_AGENT_PUBLIC_BASE_URL 与当前 tunnel 地址不一致。

4. 当前需要修的是：
   - cloudflared 辅助脚本
   - IMAGE_AGENT_PUBLIC_BASE_URL 配置诊断
   - doubaoProvider 调用豆包前的 reference image URL preflight
   - /etsy-image-agent 的小白版错误提示
   - 生成前检查，避免公网参考图不可达时调用豆包

## 当前关键文件
- scripts/setup-image-public-url.mjs
- public/etsy-image-agent.html
- public/openai-settings.html
- src/services/etsyImageAgent/config.ts
- src/services/etsyImageAgent/taskQueue.ts
- src/services/etsyImageAgent/imageProviders/doubaoProvider.ts
- src/services/etsyImageAgent/imageProviders/types.ts
- src/services/etsyImageAgent/types.ts
- src/services/app_server.ts
- README.md
- DESIGN.md
- .env.example
- package.json

## 必须保留的业务规则
- product_reference 不得退回 text_to_image。
- 无 inputAsset 必须失败 INPUT_REFERENCE_IMAGE_REQUIRED。
- doubao 模式只要求 ARK_API_KEY，不要求 OPENAI_API_KEY。
- openai 模式只要求 OPENAI_API_KEY，不要求 ARK_API_KEY。
- mock 模式不要求真实 key。
- 默认 DOUBAO_SEEDREAM_MODEL=doubao-seedream-5-0-lite-260128。
- 生成 1 张时 shotType=hero_white_background。
- 生成 6 张时只是同一商品的不同 shotType，不是不同商品。
- mojibake 文件名不得进入 prompt。
- 响应和日志不得包含完整 API key。

## 需要继续完成的任务

### 1. 检查当前环境
先运行：
- git status
- grep -n "IMAGE_AGENT_PUBLIC_BASE_URL" .env
- curl -I http://localhost:3456/
- 检查 package.json 是否已有 pnpm dev:public-url
- 检查 scripts/setup-image-public-url.mjs 是否存在
- 检查 /api/etsy-agent/image-provider-settings 返回的 publicBaseUrl 状态

注意：不要打印任何 API key。

### 2. 改进 scripts/setup-image-public-url.mjs
运行 pnpm dev:public-url 后，脚本应：
- 检查 cloudflared 是否安装。
- 检查 http://localhost:3456 是否可访问。
- 启动 cloudflared tunnel --url http://localhost:3456。
- 自动解析 https://xxxx.trycloudflare.com。
- 只更新 .env 中 IMAGE_AGENT_PUBLIC_BASE_URL 这一行。
- 不打印 .env 全文。
- 不打印任何 API key。
- 保持 tunnel 进程运行。
- 用户 Ctrl+C 时优雅退出，不要出现误导性的失败提示。
- 明确提示当前公网地址、已写入 .env、需要重启 pnpm dev、此终端必须保持打开。

### 3. 后端配置诊断
GET /api/etsy-agent/image-provider-settings 必须返回：

publicBaseUrl: {
  configured: boolean,
  value: sanitized value or null,
  isLocalhost: boolean,
  validForExternalProvider: boolean
}

当 provider=doubao 且 product_reference 模式时：
- 如果 IMAGE_AGENT_PUBLIC_BASE_URL 缺失，diagnostics 包含 IMAGE_AGENT_PUBLIC_BASE_URL_MISSING。
- 如果 IMAGE_AGENT_PUBLIC_BASE_URL 是 localhost/127.0.0.1/::1，diagnostics 包含 LOCALHOST_IMAGE_URL_NOT_ALLOWED。
- 如果配置了 trycloudflare URL，显示 configured=true。

### 4. reference image URL preflight
在 doubaoProvider 调用火山方舟前，必须先检查 public reference image URL 是否真的可下载。

要求：
- 先 HEAD。
- 如果 HEAD 不可靠，再 GET Range: bytes=0-1023。
- 接受 200 或 206，并且 Content-Type 必须是 image/jpeg、image/png、image/webp 或 image/*。
- 如果返回 530/502/503/504，返回 PUBLIC_REFERENCE_IMAGE_UNREACHABLE。
- 如果返回 404，返回 PUBLIC_REFERENCE_IMAGE_NOT_FOUND。
- 如果返回 text/html 或非 image/*，返回 PUBLIC_REFERENCE_IMAGE_NOT_IMAGE。
- 预检失败时，不要调用豆包 API。
- 错误里记录 publicReferenceUrl、localMediaUrl、statusCode、contentType、errorCode，但不要记录 API key。

### 5. 前端错误提示
在 /etsy-image-agent 失败卡片里，当出现 PUBLIC_REFERENCE_IMAGE_UNREACHABLE 或 530 时，显示：

“本地图片可以访问，但 Cloudflare 公网地址无法访问这张图。请确认：
1. 终端 1 正在运行 pnpm dev
2. 终端 2 正在运行 pnpm dev:public-url
3. .env 里的 IMAGE_AGENT_PUBLIC_BASE_URL 和终端 2 显示的 trycloudflare 地址一致
4. 如果重新运行过 pnpm dev:public-url，需要重启 pnpm dev，并重新上传图片。”

同时显示两个可复制命令：
curl -I "公网图片URL"
curl -I "本地图片URL"

### 6. 生成前检查
在用户点击“开始生成”前：
- 如果 provider=doubao 且 mode=product_reference：
  - 检查 publicBaseUrl 是否 configured。
  - 检查 reference image public URL 是否 preflight 可访问。
- 如果不可访问，阻止生成。
- 不要让请求进入豆包，避免失败和扣费。
- UI 上显示 Provider、Mode、Public base URL、Reference image URL reachable/unreachable。

### 7. 测试
新增或更新测试：
- 200 image/jpeg => pass
- 206 image/png => pass
- 530 text/html => PUBLIC_REFERENCE_IMAGE_UNREACHABLE，不调用豆包
- 404 => PUBLIC_REFERENCE_IMAGE_NOT_FOUND，不调用豆包
- 200 text/html => PUBLIC_REFERENCE_IMAGE_NOT_IMAGE，不调用豆包
- 本地 media URL 200 但 public URL 530 时，返回 PUBLIC_REFERENCE_IMAGE_UNREACHABLE
- setup-image-public-url.mjs 只修改 IMAGE_AGENT_PUBLIC_BASE_URL，不修改或打印 API key
- doubao 模式不要求 OPENAI_API_KEY
- 缺 public base URL 时返回 NEED_PUBLIC_IMAGE_URL
- 响应和日志不包含 ARK_API_KEY 明文

### 8. 验证
完成后运行：
pnpm typecheck
pnpm test
pnpm build
pnpm verify:local

如果失败，明确报告失败原因，不要假装成功。

## 小白版最终操作步骤
Codex 修完后，用户应该只需要：

终端 1：
pnpm dev

终端 2：
pnpm dev:public-url

等终端 2 显示 trycloudflare 地址后，回到终端 1：
Ctrl+C
pnpm dev

然后打开：
http://localhost:3456/etsy-image-agent

重新上传图片，只生成 1 张测试。
