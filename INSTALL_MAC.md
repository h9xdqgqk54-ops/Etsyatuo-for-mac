# Mac 安装说明

## 1. 下载交付包

下载仓库中的：

```text
dist/delivery/Etsyauto-Mac.zip
```

如需校验文件完整性，下载后运行：

```bash
shasum -a 256 Etsyauto-Mac.zip
```

结果应为：

```text
21c406be963829db11b0fe72f16c45fcad021b7477a2d224a4008d292059b7ed
```

## 2. 解压并启动

1. 双击 `Etsyauto-Mac.zip` 解压。
2. 打开解压后的 `Etsyauto-Mac` 文件夹。
3. 双击 `启动 Etsyauto.command`。
4. 终端窗口出现后不要关闭，浏览器会自动打开 Etsyauto 图片 Agent 工作台。

如果默认端口 `3456` 被占用，程序会自动切换到一个可用端口，并在终端里显示实际工作台地址。

## 3. 处理 macOS 安全提示

如果 macOS 首次提示“无法验证开发者”：

1. 在 Finder 中找到 `启动 Etsyauto.command`。
2. 右键点击它。
3. 选择“打开”。
4. 在弹窗中再次选择“打开”。

启动脚本会自动尝试移除下载隔离属性，并检查必要文件是否完整。

## 4. 配置图片文件夹和 Key

打开工作台后：

1. 在左侧“图片文件夹”区域选择图片输入和输出目录。
2. 进入 Provider 设置。
3. 填写 GPT5.5 Key/Base URL/Model。
4. 填写 OpenAI Key/Base URL/Image Model。

Key 只保存在当前本地服务进程中，重启程序后可能需要重新填写。交付包不会内置、上传或提交任何人的 API Key。

## 5. 停止程序

关闭启动时打开的终端窗口即可停止本地服务。

## 常见问题

### 双击没有打开浏览器

看终端窗口里打印的 `工作台:` 地址，复制到浏览器打开。

### 提示缺少文件

请完整解压 `Etsyauto-Mac.zip`，不要只移动单个 `Etsyauto` 可执行文件。`Etsyauto` 需要和 `public`、`node_modules` 保持在同一个文件夹里。

### 图片审核显示 SHARP_RUNTIME_MISSING

请确认使用的是当前仓库最新的 `Etsyauto-Mac.zip`。旧包在图片处理阶段可能无法从解压目录加载 `sharp`，新版已在真实 Mac 交付包里验证 `/api/etsy-agent/diagnostics/sharp` 通过。

### Intel Mac 能不能用

不能。当前交付包只支持 Apple Silicon arm64。
