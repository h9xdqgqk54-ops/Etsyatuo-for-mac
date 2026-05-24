# Etsyauto 图片 Agent

`/etsy-image-agent` 是当前主工作台：它读取本地图片输入目录，用 GPT5.5 为每张图生成中文电商图生图 prompt、款式英文名和 Etsy listing 文案，人工编辑/通过后，再用 OpenAI Images edit 批量生成候选图。

## Windows 合作者安装运行指南

适用于已经被邀请为本私有仓库 collaborator 的 Windows 用户。请先确认你已经接受 GitHub 仓库邀请，并且浏览器登录的是被邀请的 GitHub 账号。

### 首次安装并运行

先安装：

- Git for Windows: https://git-scm.com/downloads/win
- Node.js: https://nodejs.org/en/download

然后打开 PowerShell，执行：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force

cd $env:USERPROFILE\Desktop

npm install -g pnpm@latest-11

git clone --branch codex/openai-agent --single-branch https://github.com/h9xdqgqk54-ops/Etsyauto.git Etsyauto

cd Etsyauto

pnpm install

Copy-Item .env.example .env

notepad .env
```

在 `.env` 里填好：

```env
GPT55_API_KEY=你的_gpt55_key
OPENAI_API_KEY=你的_openai_key
OPENAI_BASE_URL=
```

保存 `.env` 后，回到 PowerShell 继续运行：

```powershell
pnpm desktop:dev
```

正常会自动打开：

```text
http://127.0.0.1:3456/etsy-image-agent
```

如果浏览器没有自动打开，就手动复制上面的地址到浏览器。

### 以后再次运行

```powershell
cd $env:USERPROFILE\Desktop\Etsyauto
pnpm desktop:dev
```

### 更新代码后再运行

```powershell
cd $env:USERPROFILE\Desktop\Etsyauto
git pull
pnpm install
pnpm desktop:dev
```

### 如果端口被占用

```powershell
cd $env:USERPROFILE\Desktop\Etsyauto
pnpm desktop:dev -- --port 0
```

### 打包成 Windows 双击程序

```powershell
cd $env:USERPROFILE\Desktop\Etsyauto
pnpm package:win
```

打包结果在：

```text
dist\delivery\Etsyauto-Windows.zip
```

解压后双击 `Etsyauto.exe` 即可运行。不要把 API Key 写进仓库或打包进程序里。

### 常见问题

如果提示 `Repository not found`，说明还没有接受 GitHub 邀请，或者登录了错误的 GitHub 账号。

如果提示 `pnpm.ps1 cannot be loaded`，重新执行：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force
```

然后关闭 PowerShell，再重新打开。

## 本地文件夹

默认目录：

- `~/Desktop/图片输入`
- `~/Desktop/图片输出`

也可以直接在 `/etsy-image-agent` 左侧“图片文件夹”区域填写并保存输入/输出目录；网页保存的本机路径优先于 `.env`，适合换电脑后重新配置。也可以在 `.env` 覆盖默认值：

```env
IMAGE_AGENT_INPUT_DIR=/absolute/path/to/input
IMAGE_AGENT_OUTPUT_DIR=/absolute/path/to/output
```

输入目录不存在会返回 `INPUT_DIR_NOT_FOUND`，前端会提示创建目录。图片支持 `jpg`、`jpeg`、`png`、`webp`。Prompt records 只依赖 `inputAssetId + ImagePromptRecord`，不再读取单独的提示词目录。

## Provider 配置

GPT5.5 只用于文本和视觉理解：

```env
PROMPT_PROVIDER=gpt55
GPT55_API_KEY=your_gpt55_key_here
GPT55_BASE_URL=https://allin-api.com/v1
GPT55_MODEL=gpt-5.5
GPT55_MAX_INPUT_MB=5
GPT55_BATCH_LIMIT=10
```

默认 GPT5.5 Base URL 是 `https://allin-api.com/v1`。网页 Provider 设置页里的 GPT5.5 Key/Base URL/Model 保存后只在当前服务进程内存生效；测试按钮只做诊断，不会把 key 写入浏览器存储或本地配置文件。

OpenAI 只用于最终图生图：

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
```

`GPT55_API_KEY` 不给 OpenAI 图生图用，`OPENAI_API_KEY` 不给 GPT5.5 文本/视觉任务用，`EAST_REASONING_API_KEY` 只属于货源/选品推理，不参与图片理解或图生图。

## 工作流

1. 打开 `/etsy-image-agent`，点击“扫描图片”登记输入图。
2. 点击“根据图片自动生成提示词”，GPT5.5 为缺失 prompt 的图片生成 `ImagePromptRecord`；也可以在单张卡片里手动填写并保存 prompt。
3. 在前端逐张编辑 role、prompt、negative prompt，点击“保存修改”。
4. 点击单张卡片的“通过并生成图片”，OpenAI 立即用同一张输入图和对应 prompt 快照调用 `images.edit`；连续点击多张会并发生成，互不阻塞。
5. 生成结果先保存为内部候选图；点击“通过并保存到输出文件夹”复制到输出目录并清理候选记录。
6. 在商品工作台维护款式英文名和 Etsy listing 文案，可用中文建议让 GPT5.5 统一优化英文输出。

Prompt records 落盘在 `data/etsy-agent/prompt-records.json`，重启本地服务后不会丢失。批量重新生成会跳过人工 `edited` / `approved` 的记录；单张覆盖需要二次确认。

## 页面

- `/etsy-image-agent`：主工作台，Prompt 生成、人工确认、OpenAI 生图和质检。
- `/settings/openai`：Provider 状态页，显示 GPT5.5 Prompt Provider 和 OpenAI Image Provider 的脱敏配置状态。

`/settings/openai` 也可以临时填写 `GPT55_API_KEY`、`GPT55_BASE_URL`、`GPT55_MODEL` 和 OpenAI 配置。浏览器只把这些值提交给本地后端，实际 GPT5.5 和 OpenAI 调用仍由后端完成；网页输入的 key 只保存在服务进程内存，重启后丢失。有效的 `.env` key 优先于网页 session key。

网页不会把任何 key 写入 `localStorage`、`sessionStorage`、前端源码或测试快照。API 响应只返回 `configured`、`maskedKey`、`fingerprint` 等脱敏状态，日志不记录图片 base64。

## CLI 启动器和 Windows exe

本项目提供一个轻量 CLI 启动器：启动本地后端服务，然后自动打开浏览器里的 `/etsy-image-agent` 工作台。用户仍然在网页工作台里选择图片输入/输出文件夹、配置 Provider、审核 prompt、审核图片和编辑文案。

本地开发启动：

```bash
npm run desktop:dev
# 或
pnpm desktop:dev
```

常用参数：

```bash
npm run desktop:dev -- --port 0
npm run desktop:dev -- --no-open --port 3456
# 或
pnpm desktop:dev -- --port 0
pnpm desktop:dev -- --no-open --port 3456
```

Windows 打包在 Windows 电脑或 Windows CI 上执行：

```bash
npm install
npm run package:win
# 或
pnpm install
pnpm package:win
```

打包产物：

```text
dist/win/Etsyauto.exe
```

Windows 用户双击 `Etsyauto.exe` 后，会打开一个命令行窗口并启动浏览器工作台。关闭该命令行窗口即可停止本地服务。桌面版默认把本机数据写到 `%APPDATA%/Etsyauto/data`，把素材缓存写到 `%APPDATA%/Etsyauto/storage`；图片输入和图片输出目录仍然由用户在网页左侧“图片文件夹”里选择并保存。

不要把你的 GPT5.5 或 OpenAI API Key 打进 `.exe`。发送给别人使用时，让对方在 `/settings/openai` 页面填写自己的 Key；网页提交给本地服务后只保存在服务进程内存，重启程序后需要重新填写，除非对方自己维护本机 `.env`。

## 验证

```bash
npm run typecheck
npm test
npm run build
npm run verify:local
npm run build:cli
# 或使用 pnpm：
# pnpm typecheck
# pnpm test
# pnpm build
# pnpm verify:local
# pnpm build:cli
```
