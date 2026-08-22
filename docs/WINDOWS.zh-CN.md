# Windows 中文安装教程

这份教程把 ChatGPT 网页端连接到你电脑里的受控项目。先用一个不重要的测试文件验收，再逐步增加项目范围。

## 0. 先确认账号入口

打开 ChatGPT 网页设置，确认能够：

- 启用 Developer mode；
- 创建自定义插件/应用；
- 在连接方式中选择 Tunnel。

本项目已在 ChatGPT Pro 网页端完成读写验收。Plus 是否具备同样入口以账号当前界面为准；没有这些入口时，仅安装本地代码也无法让网页端连接。

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
