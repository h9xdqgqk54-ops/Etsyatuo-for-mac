# Codex Handoff

## 当前目标
继续上一个 Codex session 的任务。

## 已知问题
上一个 session 出现：
Error running remote compact task: stream disconnected before completion:
error sending request for url (https://chatgpt.com/backend-api/codex/responses/compact)

## 处理原则
- 不要依赖上一个长会话继续压缩。
- 先检查 git diff、最近修改文件、测试状态。
- 先恢复上下文，再继续修改。
- 不要重复已经验证失败的路径。
- 每轮修改后运行相关测试并记录结果。

## 新 session 启动后第一步
1. 阅读 AGENTS.md 和 CODEX_HANDOFF.md。
2. 运行 git status 和 git diff。
3. 总结当前状态。
4. 给出继续计划。
