# 在其他机器上完整安装

本仓库保存 Simplify 界面与主题、后台 Subagent，以及个人使用的 `question` 和 `/handoff` 扩展。它们通过三个独立包入口加载，安装主包仍只启用 Simplify，不会自动注册其他工具。

## 环境

- Git、Node.js **22.19.0 或更新版本**，以及 npm。
- **Pi 1.4.0 或更新版本**（`@earendil-works/pi-coding-agent`）。Subagent 使用该版本的后台通信与生命周期 API。
- 在新机器单独配置模型供应商及凭据。仓库不包含 API Key、登录凭据、会话历史和本机 `settings.json`。

```bash
npm install -g @earendil-works/pi-coding-agent@1.4.0
pi --version
```

## 完整安装

在新机器的终端执行。以下使用 `~/IdeaProjects`；也可选择其他长期保留的目录。

```bash
mkdir -p ~/IdeaProjects
cd ~/IdeaProjects
git clone https://github.com/6spot/pi-simplify-extensions.git
cd pi-simplify-extensions
npm ci

pi install "$PWD"
pi install "$PWD/subagent"
pi install "$PWD/companions"

pi install git:github.com/NVlabs/SoL-Pi
pi install npm:pi-web-search

mkdir -p ~/.pi/agent/agents
cp -n subagent/agents/*.md ~/.pi/agent/agents/
pi list
```

`cp -n` 保留目标目录里已有的同名 Agent。仓库提供 `scout`、`planner`、`worker`、`reviewer` 四个通用角色，不指定模型，默认继承父任务的模型。项目专用角色可按需另行复制到 `~/.pi/agent/agents/`，或放到项目的 `.pi/agents/` 中。

这里使用本地包路径，Pi 会直接读取这份 Git 工作区，不能在安装后删除或移动目录。Subagent 复用父目录中的工具渲染代码，须保留整个仓库，不能只复制 `subagent/`。

SoL-Pi 和 Web Search 从各自的 Git/npm 来源安装，不在本仓库复制第三方源码，也不锁定为本机已安装的版本。

启动 Pi 后：

1. 配置模型供应商，通过 `/model` 选择可用模型。
2. 在 `/settings` 选择 `simplify-dark` 或 `simplify-light`；支持自动主题切换的 Pi 也可使用 `simplify-light/simplify-dark`。
3. 通过 `pi config` 确认所需包和扩展已启用。已有会话执行 `/reload`，新会话会直接加载。
4. `question` 工具和 `/handoff` 命令由 companions 包提供；启用 `subagent` 后，`subagent_task` 会自动启用。

如需复用本机的工具选择，可将以下字段合并到 `~/.pi/agent/settings.json`（保留安装命令生成的 `packages` 及其他已有设置）：

```json
{
  "theme": "simplify-light/simplify-dark",
  "quietStartup": "header",
  "defaultTools": [
    "+grep",
    "+find",
    "+ls",
    "+question",
    "+subagent",
    "+obs_recall",
    "+update_plan",
    "+codemode",
    "+tool_search",
    "-trellis_subagent"
  ]
}
```

Subagent 的详细用法见 [Subagent 说明](../subagent/README.md)。

## 只安装界面

如果只需要 Simplify 和主题，直接从 GitHub 安装主包即可：

```bash
pi install git:github.com/6spot/pi-simplify-extensions
```

此命令不会启用 Subagent、question 或 handoff。完整安装时不要再额外安装这个 Git 来源，避免同一套界面被两个不同的包来源重复加载。

## 已有 Pi 环境

启用本仓库对应的包前，先禁用或移走旧的同名扩展，避免重复注册。尤其检查 `~/.pi/agent/extensions/subagent`、`question.ts`、`handoff.ts`，以及 `settings.json` 中已有的其他 Simplify 来源。备份应放在 `extensions` 目录之外，以免被继续自动发现。

## 更新

```bash
cd ~/IdeaProjects/pi-simplify-extensions
git pull --ff-only
npm ci
```

之后在已有 Pi 会话中执行 `/reload`。以上更新仓库中的三个本地包；SoL-Pi 和 Web Search 另用 `pi update --extensions` 更新。Agent 角色已复制到个人目录，后续变更需要自行核对后更新。
