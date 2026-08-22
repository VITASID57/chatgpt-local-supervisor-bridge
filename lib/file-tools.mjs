import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { loadConfig, requireString, RUNTIME_ROOT } from "./common.mjs";
import { getWorkspace, resolveWorkspacePath, relativeTo } from "./policy.mjs";

async function context(args) {
  const workspace = await getWorkspace(requireString(args, "workspaceId"));
  return { workspace, config: await loadConfig() };
}

function digest(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function isProbablyBinary(buffer) {
  return buffer.subarray(0, Math.min(buffer.length, 8000)).includes(0);
}

async function walk(workspace, root, { max = 4000 } = {}) {
  const output = [];
  const pending = [root];
  while (pending.length && output.length < max) {
    const current = pending.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if ([".git", "node_modules", ".next", "dist", "build", "coverage"].includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      try { await resolveWorkspacePath(workspace, relativeTo(workspace, full)); } catch { continue; }
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) output.push(full);
      if (output.length >= max) break;
    }
  }
  return output;
}

export async function listFiles(args) {
  const { workspace, config } = await context(args);
  const base = await resolveWorkspacePath(workspace, args.path || ".");
  const depth = Math.max(1, Math.min(Number(args.depth || 2), 6));
  const output = [];
  async function visit(current, level) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if ([".git", "node_modules", ".next"].includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      try { await resolveWorkspacePath(workspace, relativeTo(workspace, full)); } catch { continue; }
      const item = { path: relativeTo(workspace, full), type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other" };
      if (entry.isFile()) item.size = (await fs.stat(full)).size;
      output.push(item);
      if (entry.isDirectory() && level < depth && output.length < config.maxSearchFiles) await visit(full, level + 1);
      if (output.length >= config.maxSearchFiles) break;
    }
  }
  const stat = await fs.stat(base);
  if (stat.isDirectory()) await visit(base, 1);
  else output.push({ path: relativeTo(workspace, base), type: "file", size: stat.size });
  return { workspaceId: workspace.workspaceId, entries: output, truncated: output.length >= config.maxSearchFiles };
}

export async function readFile(args) {
  const { workspace, config } = await context(args);
  const target = await resolveWorkspacePath(workspace, requireString(args, "path"));
  const buffer = await fs.readFile(target);
  if (buffer.length > config.maxReadBytes) throw new Error(`File exceeds ${config.maxReadBytes} byte read limit`);
  if (isProbablyBinary(buffer)) throw new Error("Binary files cannot be read as text");
  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, Number(args.startLine || 1));
  const end = Math.min(lines.length, Number(args.endLine || lines.length), start + 1999);
  return { path: relativeTo(workspace, target), sha256: digest(buffer), totalLines: lines.length, startLine: start, endLine: end, content: lines.slice(start - 1, end).join("\n") };
}

export async function searchText(args) {
  const { workspace, config } = await context(args);
  const query = requireString(args, "query");
  const base = await resolveWorkspacePath(workspace, args.path || ".");
  const stat = await fs.stat(base);
  const files = stat.isFile() ? [base] : await walk(workspace, base, { max: config.maxSearchFiles });
  const matches = [];
  const needle = args.caseSensitive ? query : query.toLowerCase();
  for (const file of files) {
    if (matches.length >= 200) break;
    const fileStat = await fs.stat(file);
    if (fileStat.size > config.maxReadBytes) continue;
    const buffer = await fs.readFile(file);
    if (isProbablyBinary(buffer)) continue;
    const lines = buffer.toString("utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const haystack = args.caseSensitive ? line : line.toLowerCase();
      if (haystack.includes(needle) && matches.length < 200) matches.push({ path: relativeTo(workspace, file), line: index + 1, text: line.slice(0, 500) });
    });
  }
  return { query, matches, truncated: matches.length >= 200 };
}

async function assertExpected(target, expectedSha256) {
  try {
    const current = await fs.readFile(target);
    if (!expectedSha256) throw new Error("expectedSha256 is required when changing an existing file");
    if (digest(current) !== expectedSha256) throw new Error("File changed since it was read; read it again before writing");
    return current;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicWrite(target, content) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.mcp-${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, target);
}

export async function writeFile(args) {
  const { workspace, config } = await context(args);
  const target = await resolveWorkspacePath(workspace, requireString(args, "path"), { allowMissing: true });
  if (typeof args.content !== "string") throw new Error("content must be a string");
  if (Buffer.byteLength(args.content) > config.maxWriteBytes) throw new Error("Write exceeds configured size limit");
  await assertExpected(target, args.expectedSha256);
  await atomicWrite(target, args.content);
  return { path: relativeTo(workspace, target), sha256: digest(Buffer.from(args.content)), bytes: Buffer.byteLength(args.content) };
}

export async function replaceText(args) {
  const { workspace, config } = await context(args);
  const target = await resolveWorkspacePath(workspace, requireString(args, "path"));
  const oldText = requireString(args, "oldText");
  if (typeof args.newText !== "string") throw new Error("newText must be a string");
  const current = await assertExpected(target, requireString(args, "expectedSha256"));
  const text = current.toString("utf8");
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`oldText must match exactly once; found ${count}`);
  const updated = text.replace(oldText, args.newText);
  if (Buffer.byteLength(updated) > config.maxWriteBytes) throw new Error("Updated file exceeds configured size limit");
  await atomicWrite(target, updated);
  return { path: relativeTo(workspace, target), sha256: digest(Buffer.from(updated)), replacements: 1 };
}

export async function moveToTrash(args) {
  const { workspace } = await context(args);
  const target = await resolveWorkspacePath(workspace, requireString(args, "path"));
  if (target.toLowerCase() === path.resolve(workspace.root).toLowerCase()) throw new Error("Cannot trash a workspace root");
  const trashId = `${Date.now()}-${crypto.randomUUID()}`;
  const trashDir = path.join(RUNTIME_ROOT, "trash", trashId);
  await fs.mkdir(trashDir, { recursive: true });
  await fs.rename(target, path.join(trashDir, "payload"));
  const metadata = { trashId, workspaceId: workspace.workspaceId, originalPath: relativeTo(workspace, target), deletedAt: new Date().toISOString() };
  await fs.writeFile(path.join(trashDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
  return metadata;
}

export async function listTrash() {
  const root = path.join(RUNTIME_ROOT, "trash");
  await fs.mkdir(root, { recursive: true });
  const items = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { items.push(JSON.parse(await fs.readFile(path.join(root, entry.name, "metadata.json"), "utf8"))); } catch {}
  }
  return { items };
}

export async function restoreTrash(args) {
  const trashId = requireString(args, "trashId");
  if (!/^[0-9]+-[0-9a-f-]+$/i.test(trashId)) throw new Error("Invalid trashId");
  const trashDir = path.join(RUNTIME_ROOT, "trash", trashId);
  const metadata = JSON.parse(await fs.readFile(path.join(trashDir, "metadata.json"), "utf8"));
  const workspace = await getWorkspace(metadata.workspaceId);
  const destination = await resolveWorkspacePath(workspace, metadata.originalPath, { allowMissing: true });
  try {
    await fs.access(destination);
    throw new Error("Original path already exists; restoration stopped");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(path.join(trashDir, "payload"), destination);
  await fs.rm(trashDir, { recursive: true });
  return { restored: true, workspaceId: workspace.workspaceId, path: metadata.originalPath };
}
