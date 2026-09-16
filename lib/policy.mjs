import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, run, sha256, BRIDGE_ROOT } from "./common.mjs";

const SECRET_NAMES = /(^|[\\/])(\.env(?:\..*)?|\.npmrc|\.pypirc|credentials?(?:\..*)?|secrets?(?:\..*)?|tokens?(?:\..*)?|id_(?:rsa|ed25519)|\.ssh)([\\/]|$)/i;
const SECRET_EXTENSIONS = /\.(?:pem|key|pfx|p12|kdbx)$/i;

function normalize(value) {
  return path.resolve(value).replace(/[\\/]+$/, "").toLowerCase();
}

export function isInside(candidate, root) {
  const c = normalize(candidate);
  const r = normalize(root);
  return c === r || c.startsWith(`${r}${path.sep.toLowerCase()}`);
}

export function isSecretRelativePath(relativePath) {
  const portable = String(relativePath).replace(/\\/g, "/");
  return SECRET_NAMES.test(portable) || SECRET_EXTENSIONS.test(portable);
}

async function realOrExistingAncestor(target) {
  let current = target;
  const suffix = [];
  while (true) {
    try {
      const real = await fs.realpath(current);
      return path.join(real, ...suffix.reverse());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.push(path.basename(current));
      current = parent;
    }
  }
}

async function deniedRoots() {
  const config = await loadConfig();
  const configured = (config.denyRoots || []).filter(Boolean).map(item => path.resolve(item));
  return Promise.all(configured.map(root => realOrExistingAncestor(root)));
}

function denied(candidate, roots) {
  return roots.some(root => isInside(candidate, root));
}

async function worktrees(project, roots) {
  if (!project.git) return [{ path: path.resolve(project.root), branch: null, head: null, bare: false }];
  const response = await run("git", ["-c", `safe.directory=${project.root}`, "-C", project.root, "worktree", "list", "--porcelain"], { timeoutMs: 20000 });
  if (response.code !== 0) return [{ path: path.resolve(project.root), branch: null, head: null, bare: false, warning: response.stderr.trim() }];
  const blocks = response.stdout.trim().split(/\r?\n\r?\n/).filter(Boolean);
  return blocks.map(block => {
    const item = { path: "", branch: null, head: null, bare: false };
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) item.path = path.resolve(line.slice(9));
      else if (line.startsWith("branch ")) item.branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line.startsWith("HEAD ")) item.head = line.slice(5);
      else if (line === "bare") item.bare = true;
      else if (line === "detached") item.detached = true;
    }
    return item;
  }).filter(item => item.path && !denied(item.path, roots));
}

export async function listWorkspaces() {
  const config = await loadConfig();
  const roots = await deniedRoots();
  const answer = [];
  for (const project of config.projects) {
    for (const item of await worktrees(project, roots)) {
      answer.push({
        workspaceId: `${project.id}-${sha256(item.path.toLowerCase()).slice(0, 10)}`,
        projectId: project.id,
        projectLabel: project.label,
        root: item.path,
        branch: item.branch,
        head: item.head,
        detached: Boolean(item.detached),
        bare: Boolean(item.bare),
        warning: item.warning
      });
    }
  }
  return answer;
}

export async function getWorkspace(workspaceId) {
  const found = (await listWorkspaces()).find(item => item.workspaceId === workspaceId);
  if (!found) throw new Error("Unknown workspaceId. Call list_workspaces again.");
  return found;
}

function assertAllowedText(relativePath) {
  const portable = String(relativePath).replace(/\\/g, "/");
  if (!portable || portable === ".") return;
  if (portable.startsWith("../") || path.isAbsolute(relativePath)) throw new Error("Path must stay inside the selected workspace");
  if (/(^|\/)\.git(\/|$)/i.test(portable)) throw new Error("Git internals are not exposed");
  if (isSecretRelativePath(portable)) throw new Error("Secret-bearing paths are not exposed");
}

export async function resolveWorkspacePath(workspace, relativePath = ".", { allowMissing = false } = {}) {
  assertAllowedText(relativePath);
  const roots = await deniedRoots();
  const root = await fs.realpath(workspace.root);
  workspace.root = root;
  const candidate = path.resolve(root, relativePath);
  if (!isInside(candidate, root)) throw new Error("Path escapes the selected workspace");
  const checked = await realOrExistingAncestor(candidate);
  if (!isInside(checked, root)) throw new Error("Linked path escapes the selected workspace");
  if (denied(checked, roots)) throw new Error("This path is blocked by denyRoots");
  if (isInside(checked, BRIDGE_ROOT)) throw new Error("The bridge cannot modify or inspect itself");
  if (!allowMissing) await fs.access(checked);
  return checked;
}

export function relativeTo(workspace, absolutePath) {
  return path.relative(workspace.root, absolutePath).replace(/\\/g, "/") || ".";
}
