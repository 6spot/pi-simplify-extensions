# 个人配套扩展

从本机 `~/.pi/agent/extensions/` 收录现有的 `question.ts` 和 `handoff.ts`，保留原有行为。两者使用 Pi 提供的运行时依赖，要求 Pi 1.4.0 或更新版本。

- `question`：带选项与自定义输入的交互式提问工具。
- `/handoff <目标>`：从当前对话生成新会话提示词，编辑确认后交接。

克隆完整仓库并在根目录运行 `npm ci` 后，执行 `pi install /absolute/path/pi-simplify-extensions/companions`。启用前移走或禁用旧的同名扩展，备份放在自动加载目录之外。已有会话执行 `/reload`。

详见 [跨机器安装说明](../docs/install.md)。
