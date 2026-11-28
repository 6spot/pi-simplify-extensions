---
id: k-bc5db0188b59
title: Pi 1.7.0 适配：上下文 Bash 预览、Codemode 摘要高亮与测试基线
status: delivered
stage: null
verification: self
parent: null
dependsOn: []
priority: P2
createdAt: 2026-11-28T00:45:24.459Z
---

## 目标与范围

按用户确认的三项修改适配 Pi 1.7.0。`/context` 按原生 `excludeFromContext` 标志处理 Bash 历史。Codemode 的脚本摘要复用 Pi 的 JavaScript 语法高亮。仓库开发依赖、类型检查与宿主测试采用 Pi 1.7.0。快捷键跟随 Pi 绑定留待用户另行决定。

## 完成条件

### Requirement: Bash 上下文与模型输入一致

#### Scenario: 同一份会话中包含普通与排除的命令

- WHEN 打开包含 `!` 和 `!!` 命令的会话的 `/context` 对话预览
- THEN 普通命令及输出出现在预览和估算中，标记为排除的命令及输出不出现在两者中

### Requirement: Codemode 脚本摘要高亮

#### Scenario: 收起含多条 JavaScript 语句的脚本卡片

- WHEN 查看 Codemode 卡片中的脚本预览
- THEN 摘要有 Pi 的语法高亮，字符与原文一致，仍按原有行数预算截断，展开可读原始输入

### Requirement: 1.7.0 开发与验证基线

#### Scenario: 通过锁文件全新安装并验证

- WHEN 运行 `npm ci`、类型检查、全量测试和 `git diff --check`
- THEN 使用 Pi 1.7.0 全部通过，包含只读渲染行和全屏滚动回底部的宿主行为验证

## 待澄清

## 相关资料

Pi 1.7.0 的发布说明、`extensions/feature/context.ts`、`extensions/renderer/tool/codemode.ts`、`tests/mouse-scroll-host.test.ts`、`package.json`。

## 结果

Pi 1.7.0 的 /context 对话预览和估算跳过 !! 命令与输出，兼容缺少标志的旧 Bash 记录。Codemode 折叠脚本直接由 Pi 高亮。四个开发包与锁文件更新至 1.7.0，只读渲染类型与全屏滚动测试已适配。npm ci、类型检查、345/345 项全量测试、git diff --check 通过。使用本机 Pi 1.7.0 真实全屏会话核对普通与排除的命令、深浅主题关键词和字符串颜色、展开输入，并保存了卡片预览。快捷键按用户要求留待决定。
