import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { getWorkspace, resolveWorkspacePath } from "./policy.mjs";
import { requireString, run, clip, RUNTIME_ROOT, loadConfig, normalizeSpawn } from "./common.mjs";

const processes = new Map();
const CHECK_PATTERN = /(^|:|-)(check|test|lint|typecheck|type-check|build|verify)(:|-|$)/i;
const START_PATTERN = /^(dev|start|preview)(:|$)/i;
const SAFE_SCRIPT_NAME = /^[A-Za-z0-9._:@/-]+$/;
const SUPPORTED_MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);

async function packageContext(args) {
  const workspace = await getWorkspace(requireString(args, "workspaceId"));
  const packageDir = await resolveWorkspacePath(workspace, args.path || ".");
  const packageJson = JSON.parse(await fs.readFile(path.join(packageDir, "package.json"), "utf8"));
  return { workspace, packageDir, packageJson };
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function runner(packageJson) {
  const declaredManager = String(packageJson.packageManager || "").split("@")[0];
  const manager = SUPPORTED_MANAGERS.has(declaredManager) ? declaredManager : "npm";
  const windows = process.platform === "win32";

  if (!windows) {
    if (manager === "pnpm") return { command: "pnpm", prefix: ["run"] };
    if (manager === "yarn") return { command: "yarn", prefix: [] };
    if (manager === "bun") return { command: "bun", prefix: ["run"] };
    return { command: "npm", prefix: ["run"] };
  }

  const nodeDir = path.dirname(process.execPath);
  if (manager === "bun") {
    const bun = path.join(nodeDir, "bun.exe");
    return { command: await exists(bun) ? bun : "bun.exe", prefix: ["run"] };
  }

  const wrapper = path.join(nodeDir, `${manager}.cmd`);
  if (await exists(wrapper)) {
    return { command: wrapper, prefix: manager === "yarn" ? [] : ["run"] };
  }

  if (manager === "pnpm" || manager === "yarn") {
    const corepack = path.join(nodeDir, "corepack.cmd");
    if (await exists(corepack)) {
      return { command: corepack, prefix: manager === "yarn" ? ["yarn"] : ["pnpm", "run"] };
    }
  }

  return {
    command: `${manager}.cmd`,
    prefix: manager === "yarn" ? [] : ["run"]
  };
}

function validateScriptName(script) {
  if (!SAFE_SCRIPT_NAME.test(script)) throw new Error("Script name contains unsupported characters");
}

export async function listScripts(args) {
  const { packageJson } = await packageContext(args);
  const scripts = Object.entries(packageJson.scripts || {}).map(([name, command]) => ({ name, command, allowedCheck: CHECK_PATTERN.test(name), allowedStart: START_PATTERN.test(name) }));
  return { packageName: packageJson.name, packageManager: packageJson.packageManager || "npm", scripts };
}

export async function runCheck(args) {
  const { packageDir, packageJson } = await packageContext(args);
  const script = requireString(args, "script");
  validateScriptName(script);
  if (!CHECK_PATTERN.test(script) || !packageJson.scripts?.[script]) throw new Error("Only existing check/test/lint/typecheck/build/verify scripts may run");
  const selected = await runner(packageJson);
  const response = await run(selected.command, [...selected.prefix, script], { cwd: packageDir, timeoutMs: Math.min(Number(args.timeoutMs || 300000), 900000), env: { CI: "1" } });
  return { script, exitCode: response.code, stdout: clip(response.stdout), stderr: clip(response.stderr) };
}

export async function startScript(args) {
  const { workspace, packageDir, packageJson } = await packageContext(args);
  const script = requireString(args, "script");
  validateScriptName(script);
  if (!START_PATTERN.test(script) || !packageJson.scripts?.[script]) throw new Error("Only existing dev/start/preview scripts may start");
  const selected = await runner(packageJson);
  const processId = crypto.randomUUID();
  await fs.mkdir(RUNTIME_ROOT, { recursive: true });
  const logPath = path.join(RUNTIME_ROOT, `${processId}.log`);
  const logHandle = await fs.open(logPath, "a");
  const normalized = normalizeSpawn(selected.command, [...selected.prefix, script]);
  const child = spawn(normalized.command, normalized.args, { cwd: packageDir, windowsHide: true, shell: false, detached: false, stdio: ["ignore", logHandle.fd, logHandle.fd] });
  processes.set(processId, { processId, pid: child.pid, child, workspaceId: workspace.workspaceId, script, logPath, startedAt: new Date().toISOString(), state: "running" });
  child.on("error", error => {
    const item = processes.get(processId);
    if (item) { item.state = "failed"; item.error = error.message; }
    logHandle.close().catch(() => {});
  });
  child.on("close", code => {
    const item = processes.get(processId);
    if (item) { item.state = "exited"; item.exitCode = code; }
    logHandle.close().catch(() => {});
  });
  return { processId, pid: child.pid, workspaceId: workspace.workspaceId, script, state: "running" };
}

export function listProcesses() {
  return { processes: [...processes.values()].map(({ child, logPath, ...item }) => item) };
}

export async function readProcessLog(args) {
  const item = processes.get(requireString(args, "processId"));
  if (!item) throw new Error("Unknown processId");
  const content = await fs.readFile(item.logPath, "utf8").catch(() => "");
  return { processId: item.processId, state: item.state, exitCode: item.exitCode, log: clip(content.slice(-120000)) };
}

export function stopProcess(args) {
  const item = processes.get(requireString(args, "processId"));
  if (!item) throw new Error("Unknown processId");
  if (item.state !== "running") return { processId: item.processId, state: item.state, exitCode: item.exitCode };
  item.child.kill();
  item.state = "stopping";
  return { processId: item.processId, state: item.state };
}

export async function captureLocalPage(args) {
  const raw = requireString(args, "url");
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) pages can be captured");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only localhost pages can be captured");
  const width = Math.max(320, Math.min(Number(args.width || 1440), 2560));
  const height = Math.max(480, Math.min(Number(args.height || 1000), 2000));
  await fs.mkdir(RUNTIME_ROOT, { recursive: true });
  const output = path.join(RUNTIME_ROOT, `capture-${crypto.randomUUID()}.png`);
  const config = await loadConfig();
  const candidates = [
    config.browserExecutable,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);
  let browser;
  for (const candidate of candidates) {
    try { await fs.access(candidate); browser = candidate; break; } catch {}
  }
  if (!browser) throw new Error("A supported browser executable was not found; set browserExecutable in config.json");
  const response = await run(browser, ["--headless=new", "--disable-gpu", `--window-size=${width},${height}`, `--screenshot=${output}`, url.toString()], { timeoutMs: 60000 });
  if (response.code !== 0) throw new Error(response.stderr || "Page capture failed");
  const image = await fs.readFile(output);
  await fs.unlink(output).catch(() => {});
  return { data: { url: url.toString(), width, height, bytes: image.length }, image: { data: image.toString("base64"), mimeType: "image/png" } };
}
