import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export const BRIDGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RUNTIME_ROOT = path.resolve(process.env.LOCAL_SUPERVISOR_RUNTIME || path.join(BRIDGE_ROOT, "runtime"));

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function clip(value, limit = 120000) {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…[output truncated]`;
}

export async function loadConfig() {
  const configPath = path.resolve(process.env.LOCAL_SUPERVISOR_CONFIG || path.join(BRIDGE_ROOT, "config.json"));
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  if (!Array.isArray(config.projects) || config.projects.length === 0) throw new Error("config.json must contain at least one project");
  return config;
}

export function run(command, args, { cwd, timeoutMs = 120000, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

export function result(data, { image } = {}) {
  const content = [{ type: "text", text: JSON.stringify(data, null, 2) }];
  if (image) content.push({ type: "image", data: image.data, mimeType: image.mimeType });
  const structuredContent = data && typeof data === "object" && !Array.isArray(data)
    ? data
    : { items: Array.isArray(data) ? data : [data] };
  return { content, structuredContent, isError: false };
}

export function failure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], structuredContent: { error: message }, isError: true };
}

export function requireString(args, key) {
  const value = args?.[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  return value;
}
