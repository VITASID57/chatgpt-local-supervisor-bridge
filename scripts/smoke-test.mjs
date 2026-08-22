import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const bridgeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "local-supervisor-smoke-"));
const workspace = path.join(temp, "workspace");
const denied = path.join(workspace, "private");
const runtime = path.join(temp, "runtime");
const configPath = path.join(temp, "config.json");
await fs.mkdir(denied, { recursive: true });
await fs.writeFile(configPath, JSON.stringify({
  serverName: "smoke",
  maxReadBytes: 1048576,
  maxWriteBytes: 2097152,
  maxSearchFiles: 100,
  maxToolOutputChars: 120000,
  denyRoots: [denied],
  projects: [{ id: "smoke", label: "Smoke Workspace", root: workspace, git: false }]
}), "utf8");

const child = spawn(process.execPath, [path.join(bridgeRoot, "server.mjs")], {
  cwd: bridgeRoot,
  env: { ...process.env, LOCAL_SUPERVISOR_CONFIG: configPath, LOCAL_SUPERVISOR_RUNTIME: runtime },
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true
});
const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
let nextId = 1;
lines.on("line", line => {
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (waiter) {
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  }
});

function rpc(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`Timed out waiting for ${method}`));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function call(name, args = {}) {
  const response = await rpc("tools/call", { name, arguments: args });
  return response.result;
}

try {
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
  const listed = await rpc("tools/list");
  if (listed.result.tools.length < 20) throw new Error("Tool discovery returned too few tools");
  const workspaces = await call("list_workspaces");
  const workspaceId = workspaces.structuredContent.items[0].workspaceId;

  const created = await call("write_file", { workspaceId, path: "notes/deep/check.txt", content: "first\n" });
  if (created.isError) throw new Error(created.content[0].text);
  const read = await call("read_file", { workspaceId, path: "notes/deep/check.txt" });
  const sha = read.structuredContent.sha256;
  const updated = await call("write_file", { workspaceId, path: "notes/deep/check.txt", content: "second\n", expectedSha256: sha });
  if (updated.isError) throw new Error(updated.content[0].text);
  const stale = await call("write_file", { workspaceId, path: "notes/deep/check.txt", content: "bad\n", expectedSha256: sha });
  if (!stale.isError) throw new Error("Stale SHA overwrite was not blocked");
  const secret = await call("read_file", { workspaceId, path: ".env" });
  if (!secret.isError) throw new Error("Secret path was not blocked");
  const blockedRoot = await call("list_files", { workspaceId, path: "private" });
  if (!blockedRoot.isError) throw new Error("denyRoots was not enforced");

  const trashed = await call("move_to_trash", { workspaceId, path: "notes/deep/check.txt" });
  if (trashed.isError) throw new Error(trashed.content[0].text);
  const restored = await call("restore_from_trash", { trashId: trashed.structuredContent.trashId });
  if (restored.isError) throw new Error(restored.content[0].text);
  const finalRead = await call("read_file", { workspaceId, path: "notes/deep/check.txt" });
  if (finalRead.structuredContent.content !== "second\n") throw new Error("Restored content did not match");
  process.stdout.write("MCP smoke test passed: discovery, nested write, SHA guard, secret/deny roots, trash and restore.\n");
} finally {
  child.kill();
  lines.close();
  await fs.rm(temp, { recursive: true, force: true });
}
