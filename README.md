# Pi Simplify Extensions

个人使用的 Pi TUI 展示扩展，基于 [minuque/pi-cc-extensions](https://github.com/minuque/pi-cc-extensions) 精简。

## 保留的功能

- Claude Code 风格工具卡、工具分组、点击展开与收起、Rich Diff
- Compact Thinking 思考预览（不再提供整回合 Compact Mode）
- Codex 风格输入框：灰色背景、无边框、无前缀符号、保留原生编辑能力
- 独立在输入框上方的 Working 状态，显示当前工具操作、Token 数量和耗时；工具行用静态标记避免重复转圈
- 单行无图标 Footer：左侧目录、Git、Context、费用，右侧 Thinking Level、模型；模型固定在最右端，终端窄时先精简项目信息
- Fullscreen 鼠标操作、回到底部、顶部固定用户消息
- `/context` 上下文查看
- 官方 Pi 启动欢迎页，不替换 Logo

## 安装与测试

```bash
pi install git:github.com/6spot/pi-simplify-extensions
# 安装或更新后
/reload
```

本地开发可在项目目录运行 `pi -e .`。检查代码可运行 `npm ci`、`npm run typecheck`、`npm test`。

在 Pi 的 `/settings` 中切换主题 `simplify-dark` 或 `simplify-light`。两者采用石墨蓝配色：中性灰区分工具卡和输入框，柔和蓝色用于交互，成功由绿色标记表达；Diff 保留低饱和的增删底色和行内强调，思考文字用柔和蓝色区别于工具说明。

## 配置

固定工具渲染模式为 `on`，Footer 固定为单行无图标。不再提供 `/ccstyle` 设置面板，也不读取旧的 `~/.pi/agent/pi-cc-extensions.json`。

仅修改仓库根目录的 `simplify.json`：

```json
{
  "diff": { "view": "auto", "collapsedEditLines": 12 },
  "thinking": { "previewLines": 3 }
}
```

配色通过 `themes/simplify-dark.json`、`themes/simplify-light.json` 修改。

## 与 SoL-Pi 一起使用

本扩展**不会重新注册或接管 `write` 工具**。写入前的文件快照由 `tool_execution_start` 事件读取，展示层仅使用这些快照渲染 Write Diff；因此不会与 SoL-Pi Action Fusion 争夺 `write` 的工具所有权。

如果写入前的内容无法安全读取、写入执行失败或上游工具没有提供可比较数据，则回退普通结果显示。执行结果完全由 Pi / SoL-Pi 决定。真正的取消、压缩与错误信息不会被隐藏。

## 上游更新

保留 Fork 关系；只选择性移植上游需要的功能或修复，不直接全量 Sync Fork。

感谢原作者和 Rich Diff 相关贡献者，许可证为 MIT。详见 [LICENSE](LICENSE) 和 [Diff 致谢](extensions/renderer/tool/diff/ATTRIBUTION.md)。
