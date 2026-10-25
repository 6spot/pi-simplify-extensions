# 工具卡样式目录 v1（统一确认稿）

状态：**Read 的四行预览与省略提示方向已获认可；其余样式待统一确认，均未实施。** 本文件是[工具卡展示规范](tool-card-spec.md)的分类及样式对照，不表示当前界面已经如此显示。

所有代码块都是布局示意，任务、耗时、数量和结果为说明用样例，不是实测截图。方括号是文档注释，产品不能用这些占位内容代替真实数据。示例使用 Fullscreen 的 `Expand` / `Collapse`；普通终端替换为已有原生快捷键提示。

## 1. 分类及兜底顺序

采用 **六类专用卡 + 一种全局兜底**。分类决定内容摘要，容器决定层级，不为每个工具重新发明一套外观。

| 分类 | 工具/入口 | 主要对象 | 默认折叠预览 |
| --- | --- | --- | --- |
| 内容查询 | Read、Grep、Find | 路径、查询与范围 | 最多 4 行实际内容/匹配/路径 |
| 命令执行 | Bash、PowerShell | 实际命令 | 最近 4 行输出 |
| 文件变更 | Edit、Write | 文件路径 | 真实且有界的 Diff；没有可用 Diff 时使用普通结果 |
| 计划进度 | Update Plan | 已接受计划 | 最多 6 个步骤摘要 |
| 任务协作 | Subagent、Subagent Task | 角色与短任务/操作 | 最新进展、当前问题或最多 3 行终态结论 |
| 交互提问 | Question / Ask | 当前问题与用户选择 | 当前问题/真实选择；交互由原组件负责 |
| **全局兜底** | 未适配的新工具、MCP/扩展工具、无法安全使用专用视图的结果 | 真实工具名与有界输入摘要 | 最多 4 行可展示结果；未知类型诚实说明 |

另有两类执行容器：`Multiple Tools` 和 `Codemode`。它们统一状态与父子摘要，但不改变子工具本身所属类别。Subagent 保持独立，不加入 Multiple Tools。

Skill 加载消息、后台 widget 和终态通知属于辅助展示，不增加为新的工具分类。

全局兜底的适用规则：

1. 有明确专用适配且数据满足要求时，使用本目录的对应样式。
2. 扩展已有可用专用渲染/交互时保留其正文与能力，能安全统一外层结构时按同一规则展示，不盲目拆掉原组件。
3. 没有专用适配、数据不兼容或无法安全使用专用展示时，使用同一通用卡；不能回到没有身份/状态/省略说明的裸 JSON。
4. 所有经 Pi 工具调用通道执行的新工具都应有通用展示路径；纯 widget、自定义 UI 等非工具组件不强制伪装成工具卡。
5. 兜底只影响展示，不重新注册工具、不抢占执行所有权、不改参数与结果；保留原始错误、图片和可用内容。专用展示回退不能把渲染问题伪装成工具执行失败。

## 2. 所有卡片共用的外观规则

```text
[状态] 工具类别/名称 · 关键摘要 · 实测耗时 · Expand
  主要对象（需要时）
  结果或进展预览
  … 省略的对象/数量/方向（有省略才显示）
  原始结果限制/续读说明（存在才显示）
```

- 折叠透明，无额外装饰性空行；展开使用已有中性/错误背景。原始内容中有意义的空行保留。
- 执行中 `○` 为 accent 蓝色静态标记；成功单项 `✓`、成功容器 `●`；失败 `✗`；取消 `–` 并明确 `cancelled`；等待明确 `waiting`。
- 正常结束不重复显示 `completed`。耗时仅在有真实数据时显示，长耗时改为 `8m38s` 等可读形式。
- `Expand` 表示有详情；省略提示说明预览损失；执行截断/续读说明来源限制。三个判断独立。
- 数量可信时才显示 `N more lines/paths/steps`，否则显示 `More output hidden` 等诚实说明。
- 预算按终端可见行计算；窄屏保留真实状态、工具身份和操作，优先截短对象及辅助信息。
- 所有卡片的 `Expand` / `Collapse` 统一放在标题末尾，包括 Edit/Write Diff；运行、成功、失败以及展开/收起均不改变操作所在行。增删统计放标题元信息，底部只保留内容省略/限制说明。分组子项复用父容器入口，不重复加按钮。
- 折叠预算统一为：对象/输入摘要最多 2 行；普通结果最多 4 行；计划最多 6 步；单个 Subagent 最新 1 行进展或最多 3 行终态结论；多任务最多 4 项，每项最多 1 行进展/结论；Multiple Tools/Codemode 最多 6 个子项。
- 容器嵌套按全部可见子项计预算，不逐层重新增加 6 项；达到预算就给出明确的剩余项提示。原生 Diff/图片使用专用预算和相同披露规则。

## 3. 内容查询：Read / Grep / Find

### Read（样式方向已认可）

运行：

```text
○ Read · requested lines 1–200 · Expand
  extensions/renderer/tool/message-display.ts
  Reading…
```

完成，已确认返回 177 行并完整显示前 4 行：

```text
✓ Read · lines 1–177 · Expand
  extensions/renderer/tool/message-display.ts
  import {
      BranchSummaryMessageComponent,
      CompactionSummaryMessageComponent,
      SkillInvocationMessageComponent,
  … 173 more lines in result
```

长行/折行导致无法可靠计数时用 `… More output hidden`。文件本身尚未读完时另外保留 `More available · offset=…`，不能把续读与展开混为一谈。图片继续显示原生图片结果；Stored result 继续标注存储摘录状态，不伪造行数。

### Grep

运行：

```text
○ Grep · Expand
  "useSession" · src/
  Searching…
```

完成：

```text
✓ Grep · 8 matches · Expand
  "useSession" · src/
  src/app.ts:18: useSession()
  src/auth.ts:9: useSession()
  src/profile.ts:22: useSession()
  src/settings.ts:14: useSession()
  … 4 more matches in result
```

匹配数仅统计实际结果中的匹配行，不能混入上下文。空结果显示 `No matches`；限制/截断保留原生说明，不能暗示搜索结果已完整。

### Find

运行：

```text
○ Find · Expand
  "*.test.ts" · tests/
  Finding paths…
```

完成：

```text
✓ Find · 12 paths · Expand
  "*.test.ts" · tests/
  tests/auth.test.ts
  tests/profile.test.ts
  tests/session.test.ts
  tests/settings.test.ts
  … 8 more paths in result
```

目录也计入路径。空结果显示 `No paths found`。这里的总数是已取得结果，不推断整个搜索空间的完整数量。

## 4. 命令执行：Bash / PowerShell

运行：

```text
○ Bash · 12.8s · Expand
  npm run typecheck
  [实际输出倒数第 4 行]
  [实际输出倒数第 3 行]
  [实际输出倒数第 2 行]
  [实际输出最后一行]
  … 86 earlier lines hidden
```

完成：

```text
✓ Bash · exit 0 · 14.2s · Expand
  npm run typecheck
  [实际输出尾部，最多 4 行]
  … 86 earlier lines hidden
```

失败：

```text
✗ Bash · exit 2 · 4.1s · Expand
  npm run typecheck
  src/app.ts(18,7): error TS2322: …
  [其余可用错误预览]
  … More output hidden
```

PowerShell 使用自己的工具名称，结构相同。空输出明确显示 `No output`；缺少历史退出码/耗时时省略对应字段。运行中未产生输出时显示等待首条输出，不假造命令结果。较早输出没有省略就不显示最后一行。

## 5. 文件变更：Edit / Write

运行态：

```text
○ Edit · 1.2s · Expand
  src/app.ts
  Applying changes…
```

成功，已有真实 Diff，操作仍在标题末尾：

```text
✓ Edit · +24 −8 · 2.4s · Expand
  src/app.ts
  - const layout = "cards";
  + const layout = "sections";
  … 2 more hunks
```

Write 新文件：

```text
✓ Write · +120 −0 · 1.8s · Expand
  src/section.ts
  + export function section() {
  +   return {
  +     title: "Overview",
  +     layout: "rows",
  … 116 more added lines
```

展开后仍在标题操作，只将 `Expand` 改为 `Collapse`：

```text
✓ Edit · +24 −8 · 2.4s · Collapse
  src/app.ts
  [已有展开 Diff，保留真实高亮、布局及必要限制说明]
```

Diff 保留已有语法高亮、增删层次、宽屏拆分/窄屏降级和合理预算，不强制变成纯 4 行正文。有真实且完整的统计才能显示增删/块数。缺少安全快照、无法比较或执行失败时使用同样在标题操作的普通结果视图，保留真实结果，不补造 Diff 或变化统计。

## 6. 计划进度：Update Plan

正在接收参数，尚未接受为计划：

```text
○ Update Plan · receiving…
  · 定位问题
  · 调整实现
  · 验证
```

已接受且尚未完成的计划：

```text
○ Update Plan · 2/4 · Expand
  ✓ 定位问题
  ✓ 确认数据来源
  → 调整实现
  · 验证
```

已全部完成：

```text
✓ Update Plan · 4/4 · Expand
  ✓ 定位问题
  ✓ 确认数据来源
  ✓ 调整实现
  ✓ 验证
```

预览不显示已接受计数或成功勾号。接受后的计数来自实际计划；更新工具执行成功不等于计划全部完成。超过 6 项时给出真实的更多步骤提示，展开后保留完整目标及已有决策/变更/验证信息。没有额外详情时省略展开入口。

## 7. 任务协作：Subagent / Subagent Task

### 单个任务：同步与后台使用相同结构

运行：

```text
○ Subagent · trellis-implement · 实现布局 · 12.8s · Expand
  正在调整页面布局与分区。
```

等待：

```text
○ Subagent · reviewer · 检查登录 · waiting · Expand
  需要确认：此次是否检查第三方登录？
```

完成：

```text
✓ Subagent · trellis-check · 检查布局 · 8m38s · Expand
  Review complete. Two findings.
  [已有问题正文摘录，整体最多 3 行]
  … More result details hidden
```

失败：

```text
✗ Subagent · reviewer · 检查布局 · 3.2s · Expand
  [实际错误原因]
  … More error details hidden
```

没有额外结果/错误被省略就不显示最后一行。原始任务路径、执行记录及可用用量进入展开详情；短标题优先目标描述，不拿 `Active task:` 路径充当任务名。预览使用原始结论，不让空行和孤立 Markdown 标题耗尽预算，不自动翻译或调用模型生成总结。

### 同步并行与链式

并行执行中：

```text
○ Subagent · parallel · 1 done · 1 running · Expand
  ├ ✓ reader · 定位布局
  │   找到需要调整的位置。
  └ ○ worker · 调整布局 · 12.8s
      正在调整页面分区。
```

链式全部完成：

```text
● Subagent · chain · 2 done · Expand
  ├ ✓ planner · 制定方案
  │   已给出实施步骤。
  └ ✓ worker · 实施方案
      [实际结果结论]
```

每项保留角色/短任务、真实状态及最多 1 行进展/结论。折叠最多展示最近 4 项，有更早任务时明确 `… N earlier tasks hidden`，不能误写成后续任务；任务正文被省略时统一补充 `… More task details hidden`。失败、取消和未开始只根据真实编排状态显示；混合失败不能显示全成功容器。

### Subagent Task 的状态查询与控制

查询/等待某任务时复用任务卡，显示当前状态；只有历史快照时明确 `at snapshot`。例如：

```text
○ Subagent Task · reviewer · 检查布局 · waiting · Expand
  需要确认：此次是否检查第三方登录？
```

发送指令等控制动作显示操作结果，不能把发送成功当作子任务完成：

```text
✓ Subagent Task · send · Expand
  reviewer · 检查布局
  Instruction accepted · task running
```

取消请求同理区分“请求已接收”和“任务实际取消”。当前状态有实时数据就更新，没有就标快照。不为展示控制操作额外创建重复任务或引入新的等待轮询。

展开按 Task、Details、Reports、Result / Error / Cancelled 分区，保留实际记录和可获得的耗时/用量；不在折叠态铺执行日志。

## 8. 交互提问：Question / Ask

等待回答：

```text
○ Question · waiting · Expand
  本次是否检查第三方登录？
  Waiting for your answer.
```

已回答：

```text
✓ Question · Expand
  本次是否检查第三方登录？
  Selected · 仅检查本地登录
```

取消时明确显示 `cancelled` 及实际返回信息。选项、自由输入、焦点、快捷键与取消交互仍由原组件负责；示意卡不意味着把原生提问区强制搬到卡片内。已有 Input/选项/结果详情才能显示展开入口，长问题及多个问题的省略也必须说明。

## 9. 全局兜底：新工具 / MCP / 其他扩展工具

这是所有未适配工具共用的基础卡，不能为每接入一个新工具再临时设计样式。

运行：

```text
○ Tool · export_report · 1.2s · Expand
  format=csv · range=last_30_days
  Running…
```

完成：

```text
✓ Tool · export_report · 4.1s · Expand
  format=csv · range=last_30_days
  Export completed.
  File: reports/usage.csv
  Rows: 248
  Size: 18 KB
  … 2 more lines in result
```

失败：

```text
✗ Tool · connector_sync · 2.1s · Expand
  workspace=demo
  Connection timed out.
  … More error details hidden
```

明确知道 MCP 来源时，名称区域可以使用其真实来源及工具名：

```text
✓ MCP · docs/search · 2.1s · Expand
  query="authentication"
  [已有结果，最多 4 行]
  … More output hidden
```

兜底合同：

- 名称使用真实注册名称/可验证来源；来源未知就保留 `Tool · 原工具名`，不根据名字猜测其业务类别。
- 输入摘要最多 2 行，优先使用已知安全字段或有界数据展示；不能先完整序列化大参数再截断，不能触发 getter 或源对象的 `toJSON`。
- 文本、JSON 等可展示结果最多预览 4 行，保留明确省略说明。JSON 可以是正文，但不能丢掉卡片外壳、状态和内容边界。
- 图片保留原生显示；二进制/Base64 不直接铺屏；仅确认有结构化结果但无法安全预览时诚实标注其类型，不编造结果结论。
- 完成无可展示输出时显示 `No output`；状态未知不强行当成功；真实错误、取消和执行限制必须保留。
- 展开继续复用已有 Input / Output 和其限制说明，不承诺无限完整数据，不改原始内容或执行语义。
- 第三方自有专用交互正常时保留；回退也必须使用原始可用结果，不能通过再次执行工具来生成预览。

## 10. 执行容器与分组二级摘要

### Multiple Tools

运行：

```text
○ Multiple Tools · 1 done · 1 running · Expand
  ├ ✓ Read · src/app.ts · lines 1–177
  └ ○ Bash · npm test · 12.8s
```

完成：

```text
● Multiple Tools · 3 done · Expand
  ├ ✓ Read · src/app.ts · lines 1–177
  ├ ✓ Grep · "legacy" · 8 matches
  └ ✓ Bash · npm test · 14.2s
```

仍有运行项且已有失败：

```text
○ Multiple Tools · 1 failed · 1 running · Expand
  ├ ✗ Bash · npm test · exit 1
  └ ○ Read · src/app.ts · requested lines 1–200
```

所有普通类型的二级摘要：

```text
✓ Read · src/app.ts · lines 1–177
✓ Grep · "legacy" · 8 matches
✓ Find · "*.test.ts" · 12 paths
✓ Bash · npm test · 14.2s
✓ Edit · src/app.ts · +24 −8
✓ Write · src/section.ts · +120 −0
✓ Update Plan · 2/4 · 当前：调整实现
✓ Question · 已选择：仅检查本地登录
✓ Tool · export_report · reports/usage.csv
```

这些是语义摘要，不冒充正文预览；不重复放每个子项的 Expand，也不逐项重复提示全部结果被隐藏。子项没有可信语义摘要时使用有界参数/结果摘要；如果容器内实际展示了裁剪的正文或列表，仍要给出省略说明。超出容器可见预算时明确剩余工具数量。Plan 的子行 `✓` 表示更新调用成功，`2/4` 继续表示计划进度。Question 是否聚合沿用其已有交互策略，不为排版改变执行/提问关系。

### Codemode

运行：

```text
○ Codemode · 1 done · 1 running · Expand
  ├ ✓ Read · src/app.ts
  └ ○ Grep · "legacy" · src/
```

完成：

```text
● Codemode · 2 done · Expand
  ├ ✓ Read · src/app.ts
  └ ✓ Grep · "legacy" · 3 matches
  Result · Found 3 matching references.
```

子调用和计数只有在实际元数据可用时显示；容器返回文本也是实际结果，不能自动总结补造。子调用缺少状态就保留未知，不以容器派发成功代替执行完成。更早/更多子调用或最终结果被省略时分别说明对象和方向。展开查看实际代码、可用子调用及结果，保留原有行为。

## 11. 共同展开态、窄屏及边界状态

普通卡共同展开态：

```text
✓ Tool · export_report · 4.1s · Collapse
  Input
    [已有参数视图]
  Output
    [当前可用结果及原生内容]
    [若展示仍有上限，在此显示实际限制]
```

Read 等使用自己的标题与真实范围；Diff 使用已有 Diff 展开；Plan 和 Subagent 使用已定义的专用详情分区。展开后仍有裁剪就继续披露，不声称恢复了未返回或只存为摘录的内容。

窄屏结构示意（非精确列宽截图）：

```text
✓ Read · lines 1–177 · Expand
  extensions/renderer/tool/mess…
  [有界内容预览]
  … More output hidden
```

先精简/截短对象、任务名和辅助元信息，保留状态/工具身份与完整操作提示；极窄屏放不下时可省略屏幕操作文案，原生快捷键仍可用。不能靠改变原生 padding 或点击坐标来挤布局。

共同边界状态：

| 情况 | 应显示的内容 |
| --- | --- |
| 完成但无输出 | 成功状态 + `No output`，不杜撰总结 |
| 无匹配/无路径 | 成功状态 + `No matches` / `No paths found` |
| 取消 | `–` + `cancelled` + 已有真实原因/输出 |
| 历史状态不完整 | 明确未知/快照，不补造退出码、耗时和成功 |
| 参数尚未完整 | `○` + receiving 中性预览，不提前确认计划或执行结果 |
| 工具结果被截断 | 原生限制说明；不以普通 More output hidden 代替 |
| Read 需继续读取 | `More available · offset=…`，与本次结果省略分开 |
| Stored result | 存储/摘录语义及可用原始内容，不冒充完整结果 |

## 12. 辅助消息（不增加工具分类）

Skill：

```text
✓ Skill trellis-check · Loaded · Expand
```

`Loaded` 只表示指令加载；后续 Subagent、Read、Bash 等继续使用实际工具卡。

后台 widget 继续独立于父回合显示：

```text
○ Background tasks · 1 running · 1 waiting
  ├ ○ worker · 调整布局 · 2m14s
  └ ○ reviewer · 检查布局 · waiting for parent
```

它不是新工具调用，也不新增没有对应行为的展开按钮。

同批终态通知独立于 Multiple Tools：

```text
● Background tasks · 2 done · Expand
  ├ ✓ worker · 调整布局
  │   [实际结果结论]
  └ ✓ reviewer · 检查布局
      Review complete. Two findings.
```

失败/取消分别保留真实状态和原因，不用成功容器掩盖；有结果预览被省略时仍说明。任务卡、widget 与通知各司其职，不相互替代，不额外调用模型生成展示。

## 13. 本轮统一确认范围

建议统一确认以下内容后再实施：

1. 六类专用卡、通用兜底、执行容器及辅助消息的分类边界。
2. 各类运行/等待/完成/失败及独立/分组示例的结构、密度和操作位置。
3. Tool/MCP 兜底的名称、输入摘要、结果预览及安全降级规则。
4. 内容披露、真实状态、窄屏和原生交互等共同约束。

Read 的预览与省略提示已获认可，不能据此把其他示例默认为已确认。实现与验收继续遵循[工具卡展示规范](tool-card-spec.md)；文档示意不替代真实 Pi 和用户终端验收。
