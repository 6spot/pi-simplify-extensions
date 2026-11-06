---
id: k-bd2d60be593e
status: closed
stage: deliver
outcome: completed
branch: refs/heads/main
verification: self
parent: null
priority: P2
dependsOn: []
order: null
createdAt: 2026-11-06T08:48:27.989Z
title: 移植上游贴底展开不冻结视口，并修正运行中展开的空 Output 占位
---

用户「创建任务并执行」确认了上一条建议的范围与实施授权。

## 目标与边界

- 目标一：贴底展开工具卡时不再冻结视口。`extensions/renderer/mouse/interaction.ts` 的 `keepViewportOnExpand` 改为按点击行在视口内的位置决定：跟随底部且点击行在下半屏时保持跟随；上半屏、已脱离底部、布局树不可读时维持原冻结行为。
- 目标二：运行中展开且尚无输出时，Output 显示等待文案而不是已完成的空结果；完成态空输出不变。
- 范围：仅 `interaction.ts`、`ccstyle-tool.ts`、对应测试与 README 行为说明。
- 不做：上游 `2b887c0`（组内子卡首行只剩图标丢行）、整回合 Compact Mode、HC 主题、footer 增删配色、版本号与文档提交。

## 完成条件

- 上下半屏、已脱离底部、布局树缺失四种位置都有测试；运行中与完成态空输出都有测试。
- `npm run typecheck`、`npm test`、`git diff --check` 通过；改动文件通过 biome check。
- 提交到独立分支并合并到本地 `main`，不推送、不发布。
- 真机 fullscreen 手感由用户验收，作为未验证项保留。

## 输入引用

- 上游参考：`693d2d8`、`4fe7752`（`minuque/pi-cc-extensions`）。
- 规范：AGENTS.md「当前界面基线」「验证与验收」「代码编写约定」。

<!-- knit:progress:start -->
## 当前位置

任务已创建，待讨论。

## 关键经过

## 结果与验证

## 运行引用

## 实施

- `extensions/renderer/mouse/interaction.ts`：新增 `clickedRowInViewport`（沿 parent 找最近带 `scrollView` 的祖先 box，用其 rect 换算视口内行号），`keepViewportOnExpand` 增加 `hit` 参数；底部跟随且点击行在下半屏时直接返回（保持跟随），其余情况维持 `disableFollow`，布局树读不到时维持原行为。点击处理把已有的 `hit` 传进来。
- `extensions/renderer/tool/ccstyle-tool.ts`：`renderResult` 内新增 `expandedBody`，`isPartial` 且正文为空时显示 `Waiting for output…` / `Receiving arguments…`，覆盖 codemode、file 面板、shell、通用兜底四处展开视图。
- README 补充运行中展开的空输出与贴底展开的视口行为。

## 验证

- `npm run typecheck`：通过（tsc --noEmit，无输出）。
- `npm test`：335 个用例，331 通过、4 跳过、0 失败。
- 新增用例在还原源码后确认会失败（`a running expanded tool waits for output…` 断言失败；mouse-interaction 因缺少导出报错），恢复后通过。
- `npx biome check` 改动文件：通过。
- `git diff --check`：通过。
- 提交 `5c87719` 于分支 `fix/expand-viewport-and-running-output`，已 fast-forward 合并到本地 `main`；未推送、未发布。

## 未验证

- 真实 Pi fullscreen 中的贴底展开手感、以及实际动画下的视口跟随，需要用户在真机确认。上游 `2b887c0`（组内子卡首行只剩图标丢行）按范围未做。

## 阶段移交说明

实施已由主会话在分支 `fix/expand-viewport-and-running-output` 完成，并以 fast-forward 合并到本地 `main`（commit `5c87719`）。工作区里 `AGENTS.md` 的改动与 `.knit/` 目录是任务之外的既有内容，不属于本次产出。

本阶段只需核对该提交是否满足 task.md 的完成条件、运行声明中的验证命令并报告结果；不要为「产生改动」重复修改代码或测试。若认为现有产出不满足完成条件，按阻塞说明交回，不要自行扩大范围。

### 交付记录

<!-- knit:delivery:op-c210d9a9edb4 -->
- 操作: op-c210d9a9edb4
- 时间: 2026-11-06T08:55:56.431Z
- 分支: refs/heads/main
- 授权来源: 用户「创建任务并执行」及后续「下一步：status/resume」的继续授权；AGENTS.md 约定验证通过后提交并合并到本地 main，不推送、不发布
- 工作提交: 无
- 结果: 正常交付；完成验证 self（无独立检查）
- 归档目标: .knit/tasks/archive/2026-11/11-06-port-upstream-expand-viewport

<!-- knit:progress:end -->
