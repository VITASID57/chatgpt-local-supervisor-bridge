import readline from "node:readline";
import { result, failure } from "./lib/common.mjs";
import { listWorkspaces } from "./lib/policy.mjs";
import { listFiles, readFile, searchText, writeFile, replaceText, moveToTrash, listTrash, restoreTrash } from "./lib/file-tools.mjs";
import { gitStatus, gitDiff, gitLog, gitShow, gitDiffCheck, gitCommit, gitPush, projectSnapshot } from "./lib/git-tools.mjs";
import { listScripts, runCheck, startScript, listProcesses, readProcessLog, stopProcess, captureLocalPage } from "./lib/process-tools.mjs";

const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const workspace = { workspaceId: { type: "string", description: "ID returned by list_workspaces" } };
const relativePath = { path: { type: "string", description: "Path relative to the selected workspace" } };

const definitions = [
  ["list_workspaces", "List approved projects and every current Git worktree, including uncommitted work.", schema({}), listWorkspaces, true],
  ["project_snapshot", "Get key project entry files, branch, and complete uncommitted Git status.", schema(workspace, ["workspaceId"]), projectSnapshot, true],
  ["list_files", "List files and directories without exposing secrets, Git internals, denied roots, or the bridge itself.", schema({ ...workspace, ...relativePath, depth: { type: "integer", minimum: 1, maximum: 6 } }, ["workspaceId"]), listFiles, true],
  ["read_file", "Read a UTF-8 text file with line selection and a SHA-256 used for safe edits.", schema({ ...workspace, ...relativePath, startLine: { type: "integer" }, endLine: { type: "integer" } }, ["workspaceId", "path"]), readFile, true],
  ["search_text", "Search text across source files in one approved workspace.", schema({ ...workspace, ...relativePath, query: { type: "string" }, caseSensitive: { type: "boolean" } }, ["workspaceId", "query"]), searchText, true],
  ["write_file", "Create a text file or atomically replace an existing file. Existing files require the SHA from read_file.", schema({ ...workspace, ...relativePath, content: { type: "string" }, expectedSha256: { type: "string" } }, ["workspaceId", "path", "content"]), writeFile, false],
  ["replace_text", "Atomically replace one exact text occurrence. Requires the current SHA from read_file.", schema({ ...workspace, ...relativePath, oldText: { type: "string" }, newText: { type: "string" }, expectedSha256: { type: "string" } }, ["workspaceId", "path", "oldText", "newText", "expectedSha256"]), replaceText, false],
  ["move_to_trash", "Move a file or folder to the bridge recovery area instead of permanently deleting it.", schema({ ...workspace, ...relativePath }, ["workspaceId", "path"]), moveToTrash, false, true],
  ["list_trash", "List recoverable items moved to the bridge recovery area.", schema({}), listTrash, true],
  ["restore_from_trash", "Restore one recoverable item to its original location if that path is still free.", schema({ trashId: { type: "string" } }, ["trashId"]), restoreTrash, false],
  ["git_status", "Show branch plus tracked and untracked local changes.", schema(workspace, ["workspaceId"]), gitStatus, true],
  ["git_diff", "Show unstaged or staged Git diff, optionally for one path.", schema({ ...workspace, ...relativePath, staged: { type: "boolean" } }, ["workspaceId"]), gitDiff, true],
  ["git_log", "Show recent local commit history.", schema({ ...workspace, count: { type: "integer", minimum: 1, maximum: 100 } }, ["workspaceId"]), gitLog, true],
  ["git_show", "Show one revision and its file statistics.", schema({ ...workspace, revision: { type: "string" } }, ["workspaceId"]), gitShow, true],
  ["git_diff_check", "Check the working diff for whitespace errors.", schema(workspace, ["workspaceId"]), gitDiffCheck, true],
  ["git_commit", "Stage only an explicit file list and create a local commit. Refuses unrelated pre-staged changes.", schema({ ...workspace, paths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100 }, message: { type: "string" } }, ["workspaceId", "paths", "message"]), gitCommit, false, true],
  ["git_push_current", "Push the current branch without force. Requires the exact confirmation phrase PUSH_CURRENT_BRANCH.", schema({ ...workspace, remote: { type: "string" }, confirm: { type: "string" } }, ["workspaceId", "confirm"]), gitPush, false, true],
  ["list_project_scripts", "List package scripts and show which checks or local preview commands are allowed.", schema({ ...workspace, ...relativePath }, ["workspaceId"]), listScripts, true],
  ["run_project_check", "Run only an existing check, test, lint, typecheck, build, or verify package script.", schema({ ...workspace, ...relativePath, script: { type: "string" }, timeoutMs: { type: "integer", maximum: 900000 } }, ["workspaceId", "script"]), runCheck, false],
  ["start_project_script", "Start only an existing dev, start, or preview package script and keep a local log.", schema({ ...workspace, ...relativePath, script: { type: "string" } }, ["workspaceId", "script"]), startScript, false],
  ["list_processes", "List preview or dev processes started through this bridge.", schema({}), listProcesses, true],
  ["read_process_log", "Read the latest log for a process started through this bridge.", schema({ processId: { type: "string" } }, ["processId"]), readProcessLog, true],
  ["stop_process", "Stop one process previously started through this bridge.", schema({ processId: { type: "string" } }, ["processId"]), stopProcess, false, true],
  ["capture_local_page", "Capture a real screenshot of an HTTP page served on localhost.", schema({ url: { type: "string" }, width: { type: "integer" }, height: { type: "integer" } }, ["url"]), captureLocalPage, true]
];

const tools = definitions.map(([name, description, inputSchema, , readOnlyHint, destructiveHint = false]) => ({
  name,
  title: name.replaceAll("_", " "),
  description,
  inputSchema,
  annotations: { readOnlyHint, destructiveHint, idempotentHint: readOnlyHint }
}));
const handlers = Object.fromEntries(definitions.map(([name, , , handler]) => [name, handler]));

function reply(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0") return;
  if (message.method === "notifications/initialized") return;
  if (message.id === undefined) return;
  try {
    if (message.method === "initialize") {
      reply({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: message.params?.protocolVersion || "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "chatgpt-local-supervisor", version: "1.0.0" }, instructions: "Operate only approved local project workspaces. Read status and diffs before edits. Never seek denied roots, private data, or secrets. Prefer recoverable trash and explicit-file commits." } });
      return;
    }
    if (message.method === "ping") { reply({ jsonrpc: "2.0", id: message.id, result: {} }); return; }
    if (message.method === "tools/list") { reply({ jsonrpc: "2.0", id: message.id, result: { tools } }); return; }
    if (message.method === "tools/call") {
      const handler = handlers[message.params?.name];
      if (!handler) throw new Error(`Unknown tool: ${message.params?.name}`);
      const value = await handler(message.params?.arguments || {});
      const response = value?.image ? result(value.data, { image: value.image }) : result(value);
      reply({ jsonrpc: "2.0", id: message.id, result: response });
      return;
    }
    reply({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
  } catch (error) {
    if (message.method === "tools/call") reply({ jsonrpc: "2.0", id: message.id, result: failure(error) });
    else reply({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
  }
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", line => {
  if (!line.trim()) return;
  try { handle(JSON.parse(line)); }
  catch (error) { process.stderr.write(`Invalid MCP message: ${error.message}\n`); }
});
