import fs from "node:fs/promises";
import { getWorkspace, resolveWorkspacePath, relativeTo } from "./policy.mjs";
import { requireString, run, clip } from "./common.mjs";

async function gitContext(args) {
  const workspace = await getWorkspace(requireString(args, "workspaceId"));
  const probe = await run("git", ["-c", `safe.directory=${workspace.root}`, "-C", workspace.root, "rev-parse", "--is-inside-work-tree"], { timeoutMs: 15000 });
  if (probe.code !== 0 || probe.stdout.trim() !== "true") throw new Error("Selected workspace is not a Git worktree");
  return workspace;
}

async function git(workspace, args, timeoutMs = 120000) {
  const response = await run("git", ["-c", `safe.directory=${workspace.root}`, "-C", workspace.root, ...args], { timeoutMs });
  return { exitCode: response.code, stdout: clip(response.stdout), stderr: clip(response.stderr) };
}

export async function gitStatus(args) {
  return git(await gitContext(args), ["status", "--short", "--branch", "--untracked-files=all"]);
}

export async function gitDiff(args) {
  const workspace = await gitContext(args);
  const command = ["diff", "--no-ext-diff"];
  if (args.staged) command.push("--cached");
  if (args.path) {
    const target = await resolveWorkspacePath(workspace, args.path, { allowMissing: true });
    command.push("--", relativeTo(workspace, target));
  }
  return git(workspace, command);
}

export async function gitLog(args) {
  const count = Math.max(1, Math.min(Number(args.count || 20), 100));
  return git(await gitContext(args), ["log", `-${count}`, "--date=iso-strict", "--pretty=format:%h%x09%ad%x09%an%x09%s"]);
}

export async function gitShow(args) {
  const revision = args.revision || "HEAD";
  if (!/^[A-Za-z0-9_./~^{}@:-]+$/.test(revision)) throw new Error("Invalid revision");
  return git(await gitContext(args), ["show", "--stat", "--oneline", "--decorate", "--no-ext-diff", revision]);
}

export async function gitDiffCheck(args) {
  return git(await gitContext(args), ["diff", "--check"]);
}

export async function gitCommit(args) {
  const workspace = await gitContext(args);
  const message = requireString(args, "message");
  if (!Array.isArray(args.paths) || !args.paths.length || args.paths.length > 100) throw new Error("paths must contain 1-100 explicit files");
  const relativePaths = [];
  for (const item of args.paths) {
    const target = await resolveWorkspacePath(workspace, String(item), { allowMissing: true });
    relativePaths.push(relativeTo(workspace, target));
  }
  const requested = new Set(relativePaths.map(item => item.replace(/\\/g, "/")));
  const stagedBefore = await git(workspace, ["diff", "--cached", "--name-only", "--"]);
  if (stagedBefore.exitCode !== 0) return { staged: stagedBefore, committed: null };
  const unrelated = stagedBefore.stdout.split(/\r?\n/).filter(Boolean).filter(item => !requested.has(item.replace(/\\/g, "/")));
  if (unrelated.length) throw new Error(`Refusing to include unrelated pre-staged files: ${unrelated.join(", ")}`);
  const add = await git(workspace, ["add", "--", ...relativePaths]);
  if (add.exitCode !== 0) return { staged: add, committed: null };
  const stagedAfter = await git(workspace, ["diff", "--cached", "--name-only", "--"]);
  if (!stagedAfter.stdout.trim()) throw new Error("No staged changes to commit");
  return { staged: add, committed: await git(workspace, ["commit", "-m", message], 180000) };
}

export async function gitPush(args) {
  const workspace = await gitContext(args);
  if (args.confirm !== "PUSH_CURRENT_BRANCH") throw new Error("Set confirm to PUSH_CURRENT_BRANCH after reviewing status and diff");
  const branch = await git(workspace, ["branch", "--show-current"]);
  if (branch.exitCode !== 0 || !branch.stdout.trim()) throw new Error("Cannot push a detached HEAD");
  const remote = args.remote || "origin";
  if (!/^[A-Za-z0-9_.-]+$/.test(remote)) throw new Error("Invalid remote name");
  return git(workspace, ["push", remote, branch.stdout.trim()], 300000);
}

export async function projectSnapshot(args) {
  const workspace = await getWorkspace(requireString(args, "workspaceId"));
  const files = [];
  for (const name of ["AGENTS.md", "CLAUDE.md", "README.md", "docs/NOW.md", "NOW.md", "package.json"]) {
    try {
      const target = await resolveWorkspacePath(workspace, name);
      const stat = await fs.stat(target);
      if (stat.isFile()) files.push({ path: name, size: stat.size });
    } catch {}
  }
  const probe = await run("git", ["-c", `safe.directory=${workspace.root}`, "-C", workspace.root, "rev-parse", "--is-inside-work-tree"], { timeoutMs: 15000 });
  const status = probe.code === 0 && probe.stdout.trim() === "true"
    ? await git(workspace, ["status", "--short", "--branch", "--untracked-files=all"])
    : { exitCode: null, stdout: "", stderr: "This workspace is not a Git worktree." };
  return { workspace, keyFiles: files, gitStatus: status };
}
