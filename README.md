# ChatGPT Local Supervisor Bridge

让 ChatGPT 网页端通过 OpenAI 官方 Secure MCP Tunnel，安全地查看和操作你明确开放的本地项目。

它适合这样的工作流：ChatGPT 负责纵览项目、核对未提交进度、审查差异和写施工卡；本地 Agent 负责施工。必要时，ChatGPT 也可以直接修改允许范围内的文件、运行项目已有检查并查看本地预览。

> Windows-first，Node.js 零第三方依赖。非 OpenAI 官方项目；隧道客户端使用 OpenAI 官方开源项目。

## 官方支持依据

本项目本身是第三方开源桥，但它使用的传输路径是 OpenAI 官方提供的 **Secure MCP Tunnel**，不是抓取 ChatGPT 登录态、转发网页请求或把本地 Web 服务做成“反代网页”。

OpenAI 官方文档当前明确说明：

- Secure MCP Tunnel 用于把**私有 MCP server**连接到受支持的 OpenAI 产品，而无需开放公网入站端口；
- `tunnel-client` 从本地或私网环境向 OpenAI 建立**出站 HTTPS**连接，再把 MCP JSON-RPC 请求转发给本地 stdio / HTTP MCP server；
- ChatGPT、Codex、Responses API 等受支持产品都可以通过 Tunnel 调用私有 MCP server；
- ChatGPT 开发者模式中可以在创建应用时把 **Connection** 选择为 **Tunnel**；
- Tunnel 适合私有连接和 developer-mode testing，但**不等于公开插件发布通道**。公开插件仍需要稳定的公网 HTTPS MCP endpoint。

官方资料：

- [OpenAI Secure MCP Tunnel 文档](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [OpenAI tunnel-client 源码与发行版](https://github.com/openai/tunnel-client)
- [OpenAI Terms and policies](https://openai.com/policies/)

这部分用于说明“连接方式本身是官方支持路径”，不代表 OpenAI 对本仓库的第三方代码、具体部署方式或任何具体用途作出背书。实际使用仍应以当前 OpenAI 文档、账号权限和适用条款为准。

## 它能做什么

- 动态列出配置项目及其所有 Git worktree。
- 读取文件、搜索文本、查看 Git 状态、diff、日志和提交内容。
- 创建文件；覆盖已有文件前必须提供最近一次读取返回的 SHA-256。
- 精确替换唯一文本片段，防止误改多处。
- 删除改为移动到桥自己的可恢复区，并支持恢复。
- 只提交明确列出的文件；拒绝夹带无关的预暂存文件。
- 只允许非强制推送当前分支，并要求明确确认短语。
- 只运行项目已有的 check/test/lint/typecheck/build/verify 脚本。
- 只启动项目已有的 dev/start/preview 脚本，并可读取日志、停止进程。
- 截取 localhost 页面，辅助网页质检。

它**没有**任意 Shell、强制推送、硬重置、合并、永久删除或读取密钥的工具。

## 安全边界

```text
ChatGPT web
    │
    ▼
OpenAI-hosted Secure MCP Tunnel endpoint
    ▲
    │ outbound HTTPS only
    │
tunnel-client on your PC
    │ local stdio
    ▼
this bridge ── allowlisted projects and Git worktrees
              denyRoots, secret filters, SHA write guard
```

服务端强制执行以下规则，不能只靠提示词绕过：

- 只能访问 `config.json` 中的项目根目录及其 Git worktree。
- `denyRoots` 下的目录永远拒绝。
- `.env`、凭据、Token、证书、私钥、`.ssh` 和 `.git` 内部目录拒绝。
- 符号链接或 junction 不能逃出工作区。
- 桥自身的源码、配置、运行密钥和日志不能被桥读取或修改。

完整威胁模型见 [SECURITY.md](SECURITY.md)。

## 套餐与费用

本项目不调用 Responses API 或 Chat Completions API；模型推理发生在正常的 ChatGPT 网页对话中。Platform runtime API key 只用于 `tunnel-client` 向 OpenAI Tunnel 控制面认证。

公开版于 **2026-08-22 在 ChatGPT Pro 网页端完成读写实测**。对于 Plus 或其他套餐，不应只看套餐名称：需要你的账号实际出现以下入口：

1. Developer mode；
2. 创建自定义插件/应用；
3. Connection 中可以选择 Tunnel；
4. 目标聊天允许调用该插件的写入工具。

OpenAI 会调整功能开放范围，团队工作区也可能受管理员控制。因此本项目不承诺所有 Plus 账号都具备这些入口；以当前账号界面和一次真实的低风险读写测试为准。

## 准备工作

- Windows 10/11；
- Node.js 20 或更新版本；
- Git；
- OpenAI 官方 [`tunnel-client`](https://github.com/openai/tunnel-client) Windows 版本；
- 一个 Secure MCP Tunnel；
- 一个仅含 **Tunnels Read + Use** 权限的 runtime API key；
- ChatGPT 中可用的 Developer mode 和自定义插件入口。

官方资料：

- [Secure MCP Tunnel 文档](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [OpenAI tunnel-client 源码与发行版](https://github.com/openai/tunnel-client)
- [ChatGPT / Codex MCP 文档](https://learn.chatgpt.com/docs/extend/mcp)

## 快速开始

```powershell
git clone https://github.com/VITASID57/chatgpt-local-supervisor-bridge.git
cd chatgpt-local-supervisor-bridge
```

从官方 Release 下载 Windows 版 `tunnel-client.exe`，放到：

```text
vendor\tunnel-client.exe
```

运行初始化。密钥输入不会显示，并使用 Windows DPAPI 加密到当前用户：

```powershell
.\scripts\setup.ps1
```

编辑生成的 `config.json`，只填你愿意交给 ChatGPT 的项目，并把所有私人目录放进 `denyRoots`。然后检查：

```powershell
.\scripts\start-tunnel.ps1 -Mode doctor
npm run check
```

前台启动：

```powershell
.\scripts\start-tunnel.ps1
```

确认连接正常后，可安装登录自启：

```powershell
.\scripts\install-autostart.ps1
```

ChatGPT 网页端的完整连接步骤见 [Windows 中文安装教程](docs/WINDOWS.zh-CN.md)。

## Windows 上的 `spawn EINVAL`

如果桥能读文件，但一运行 `npm` / `pnpm` / `yarn` 脚本就出现 `spawn EINVAL`，优先看 [Windows 中文安装教程的故障排查](docs/WINDOWS.zh-CN.md#9-windows-上的-spawn-einval)。

这不是本项目独有的问题。Node.js 在 2024 年针对 Windows 批处理文件执行修复了 CVE-2024-27980；较新的 Node 版本会拒绝用 `child_process.spawn()` 在 `shell: false` 下直接启动 `.cmd` / `.bat`，并返回 `EINVAL`。本项目在 Windows 上会显式通过 `cmd.exe /d /s /c` 启动这类包装器，而不是打开任意 Shell 能力。

## 推荐的首次提示词

```text
只使用 Local Supervisor Bridge。先调用 list_workspaces，选择目标项目，
再读取项目规则、NOW/README、Git 状态和未提交差异。
先给出当前事实、风险和下一张施工卡；除非我明确要求，否则先不要修改文件。
```

首次写入请只创建一个无关紧要的验收文件，再用 `read_file` 回读并核对 SHA-256。验收后通过 `move_to_trash` 清理。

## 停止与撤销

```powershell
.\scripts\uninstall-autostart.ps1
```

这会停止并移除登录任务，但保留源码、配置和 DPAPI 加密密钥。完全停用时，还应在 OpenAI Platform 撤销 runtime key 并删除不再使用的 Tunnel。

## 开发

```powershell
npm test
npm run smoke
npm run check
.\scripts\verify-public.ps1
```

欢迎提交 Issue 和 PR。贡献规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

MIT。OpenAI `tunnel-client` 不包含在本仓库中，归其独立的 Apache-2.0 许可证管理。
