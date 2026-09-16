# Windows 中文安装教程

这份教程把 ChatGPT 网页端连接到你电脑里的受控项目。先用一个不重要的测试文件验收，再逐步增加项目范围。

## 0. 先确认账号入口

打开 ChatGPT 网页设置，确认能够：

- 启用 Developer mode；
- 创建自定义插件/应用；
- 在连接方式中选择 Tunnel。

本项目已在 ChatGPT Pro 网页端完成读写验收。Plus 是否具备同样入口以账号当前界面为准；没有这些入口时，仅安装本地代码也无法让网页端连接。

OpenAI 官方当前提供 Secure MCP Tunnel，用于让受支持的 OpenAI 产品连接私有 MCP server，而不要求开放公网入站端口。官方说明见：

- [Secure MCP Tunnel 文档](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
- [OpenAI tunnel-client](https://github.com/openai/tunnel-client)

本仓库是第三方项目；“官方支持”指 Tunnel 这一连接路径由 OpenAI 官方提供，不代表 OpenAI 为本仓库代码背书。

## 1. 安装基础软件

安装：

- Node.js 20 或更高版本；
- Git for Windows；
- OpenAI 官方 `tunnel-client` Windows 发行版。

把下载并校验过的 `tunnel-client.exe` 放到仓库的 `vendor` 目录：

```text
chatgpt-local-supervisor-bridge\vendor\tunnel-client.exe
```

不要从网盘或陌生教程下载隧道客户端。优先使用 [OpenAI 官方 Release](https://github.com/openai/tunnel-client/releases/latest)。

## 2. 创建 Tunnel 和受限密钥

1. 打开 OpenAI Platform 的 Tunnel 设置，创建一个 Tunnel。
2. 把它关联到你准备使用的 ChatGPT workspace。
3. 创建一个独立 runtime API key，只授予 **Tunnels Read + Use**。
4. 不要给这把密钥模型推理、管理 Tunnel 或其他无关权限。

Tunnel ID 与 runtime key 是两种不同内容。不要截图发帖，也不要写进 README、配置示例或命令历史。

## 3. 初始化本地桥

在 PowerShell 进入仓库目录：

```powershell
.\scripts\setup.ps1
```

依次输入 Tunnel ID 和 runtime key。密钥输入不可见，脚本会用 Windows DPAPI 保存到当前 Windows 用户；`profile.yaml`、`config.json` 和 `runtime` 目录已被 `.gitignore` 排除。

如果 `tunnel-client.exe` 在别处，也可以：

```powershell
.\scripts\setup.ps1 -TunnelClientPath 'C:\path\to\tunnel-client.exe'
```

## 4. 配置允许与拒绝范围

打开生成的 `config.json`：

```json
{
  "denyRoots": [
    "C:\\Users\\YOUR_NAME\\Private"
  ],
  "projects": [
    {
      "id": "site",
      "label": "My Website",
      "root": "D:\\Projects\\my-site",
      "git": true
    }
  ]
}
```

规则：

- `id` 使用简短英文，不要重复；
- `root` 只填确实愿意交给 ChatGPT 的项目；
- Git 仓库设为 `git: true`，桥会自动发现其 worktree；
- 私人资料、密码库、家庭照片、其他客户项目放进 `denyRoots`；
- 不要为了省事开放整个用户目录或整个磁盘。

## 5. 检查本地与 Tunnel

```powershell
npm run check
.\scripts\verify-public.ps1
.\scripts\start-tunnel.ps1 -Mode doctor
```

`doctor` 通过后，前台启动：

```powershell
.\scripts\start-tunnel.ps1
```

先保持这个窗口打开。

## 6. 在 ChatGPT 网页端连接

1. 打开 ChatGPT 的插件/应用管理页面；
2. 新建开发者模式插件；
3. Connection 选择 **Tunnel**；
4. 选择刚创建的 Tunnel；
5. 应用层认证选择 **None / No Authentication**；Tunnel 自己已经负责传输认证；
6. 等待工具发现完成；
7. 在新对话中启用该插件。

如果找不到 Tunnel，检查：

- 本地 `start-tunnel.ps1` 是否仍在运行；
- Tunnel 是否关联到正确的 ChatGPT workspace；
- runtime key 是否有 Tunnels Read + Use；
- 重新运行 `doctor` 查看明确错误。

## 7. 做一次低风险验收

先让 ChatGPT：

1. 调用 `list_workspaces`；
2. 读取一个公开说明文件；
3. 在测试项目创建 `bridge-acceptance.txt`；
4. 回读文件并报告 SHA-256；
5. 你在本机独立核对文件；
6. 通过 `move_to_trash` 移到恢复区。

不要把第一次验收放在生产仓库或私人目录。

## 8. 安装登录自启

验收通过后：

```powershell
.\scripts\install-autostart.ps1
```

移除自启：

```powershell
.\scripts\uninstall-autostart.ps1
```

完全撤销时，再去 OpenAI Platform 撤销 runtime key 并删除 Tunnel。

## 9. Windows 上的 `spawn EINVAL`

### 症状

桥本身在线，`list_workspaces`、`read_file` 等读取工具正常，但执行项目脚本时失败，例如：

```text
spawn EINVAL
```

常见触发点包括 `npm.cmd`、`pnpm.cmd`、`yarn.cmd` 或其他 `.cmd` / `.bat` 包装器。

### 为什么会发生

这不是 Secure MCP Tunnel 特有故障，也不是某一台电脑独有。Node.js 2024 年修复 CVE-2024-27980 后，在 Windows 上不再允许 `child_process.spawn()` / `spawnSync()` 在 `shell: false` 时直接启动 `.cmd` / `.bat` 文件；这种调用会返回 `EINVAL`。

Node.js 官方说明：

- [April 2024 Security Releases / CVE-2024-27980](https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2)
- [Child process: Spawning `.bat` and `.cmd` files on Windows](https://nodejs.org/api/child_process.html#spawning-bat-and-cmd-files-on-windows)

本项目因此在 Windows 上显式通过 `cmd.exe /d /s /c` 调用这类包装器，仍保持 `shell: false`，并限制可执行的项目脚本类型。

### 另一类常见环境差异：Corepack / PATH

有些 Windows + Node 安装不会在桥进程的 `PATH` 中暴露独立的 `pnpm.cmd` / `yarn.cmd`。如果 `package.json` 写了例如：

```json
"packageManager": "pnpm@11.19.0"
```

实际可用入口可能是与 `node.exe` 同目录的 `corepack.cmd`。本项目会优先检查 Node 安装目录中的包管理器包装器；找不到 `pnpm.cmd` / `yarn.cmd` 时，再尝试：

```text
corepack.cmd pnpm run <script>
corepack.cmd yarn <script>
```

同时会确保子进程环境能看到当前 `node.exe` 所在目录。

因此，一台机器上看到某个具体盘符，例如 `H:\corepack.cmd`，只是本机安装位置；**盘符本身不应写死进公共仓库**。

### 更新后怎么验收

```powershell
npm run check
.\scripts\start-tunnel.ps1 -Mode doctor
```

然后从 ChatGPT 里依次测试：

1. `list_project_scripts`
2. 一个允许的 `run_project_check`
3. 一个非生产项目的 `start_project_script`
4. `read_process_log`
5. `stop_process`

如果仍失败，请记录：Node 版本、`packageManager` 字段、`where node`、`where npm` / `where pnpm` / `where corepack` 的结果，以及完整错误文本。不要提交 runtime key、Tunnel ID 或私人路径内容。
