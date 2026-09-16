import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSpawn } from "../lib/common.mjs";

test("Windows .cmd wrappers are launched through cmd.exe", () => {
  const result = normalizeSpawn("npm.cmd", ["run", "check"], { platform: "win32", comspec: "C:\\Windows\\System32\\cmd.exe" });
  assert.equal(result.command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(result.args, ["/d", "/s", "/c", "npm.cmd", "run", "check"]);
});

test("Windows .bat wrappers are launched through cmd.exe", () => {
  const result = normalizeSpawn("tool.bat", ["arg"], { platform: "win32", comspec: "cmd.exe" });
  assert.equal(result.command, "cmd.exe");
  assert.deepEqual(result.args, ["/d", "/s", "/c", "tool.bat", "arg"]);
});

test("executables stay direct", () => {
  const result = normalizeSpawn("git.exe", ["status"], { platform: "win32", comspec: "cmd.exe" });
  assert.deepEqual(result, { command: "git.exe", args: ["status"] });
});

test("non-Windows commands stay direct", () => {
  const result = normalizeSpawn("pnpm", ["run", "check"], { platform: "linux", comspec: "cmd.exe" });
  assert.deepEqual(result, { command: "pnpm", args: ["run", "check"] });
});
