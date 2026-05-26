# Etsyauto for Mac

这是 Etsyauto 图片 Agent 的 Mac Apple Silicon 交付仓库。普通使用者不需要安装 Git、Node.js、npm 或 pnpm，下载 zip 后双击启动脚本即可使用本地网页工作台。

## 下载

- 交付包：[`dist/delivery/Etsyauto-Mac.zip`](dist/delivery/Etsyauto-Mac.zip)
- SHA256：见 [`CHECKSUMS.txt`](CHECKSUMS.txt)
- 详细安装说明：[`INSTALL_MAC.md`](INSTALL_MAC.md)
- 构建信息：[`BUILD_INFO.md`](BUILD_INFO.md)

## 快速开始

1. 下载 `dist/delivery/Etsyauto-Mac.zip`。
2. 双击解压，进入 `Etsyauto-Mac` 文件夹。
3. 双击 `启动 Etsyauto.command`。
4. 如果 macOS 提示无法验证开发者，在 Finder 里右键 `启动 Etsyauto.command`，选择“打开”。
5. 保持终端窗口打开，浏览器会自动进入 `http://127.0.0.1:3456/etsy-image-agent`。
6. 在网页里选择图片输入/输出文件夹，并在 Provider 设置中填写自己的 GPT5.5 和 OpenAI Key。

## 适用范围

- 支持：Apple Silicon Mac，也就是 M1、M2、M3、M4 系列。
- 不支持：Intel Mac。

交付包不会内置任何 API Key。每位使用者都需要在自己的电脑上填写自己的 Key。
