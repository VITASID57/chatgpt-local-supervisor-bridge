import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { isInside, isSecretRelativePath } from "../lib/policy.mjs";

test("isInside accepts a root and its descendants only", () => {
  const root = path.resolve("sandbox", "project");
  assert.equal(isInside(root, root), true);
  assert.equal(isInside(path.join(root, "src", "app.mjs"), root), true);
  assert.equal(isInside(path.resolve("sandbox", "project-copy"), root), false);
});

test("secret path detection blocks credentials but not ordinary source names", () => {
  assert.equal(isSecretRelativePath(".env.local"), true);
  assert.equal(isSecretRelativePath("config/credentials.json"), true);
  assert.equal(isSecretRelativePath("certs/client.p12"), true);
  assert.equal(isSecretRelativePath("src/tokenizer.mjs"), false);
});
