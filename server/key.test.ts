import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readKey } from "./model.ts";

function keyFile(content: string, mode = 0o600): string {
  const dir = mkdtempSync(join(tmpdir(), "key-"));
  const path = join(dir, "key");
  writeFileSync(path, content);
  chmodSync(path, mode);
  return path;
}

test("reads an owner-only regular file", async () => {
  assert.equal(await readKey(keyFile("abcdefgh")), "abcdefgh");
});

test("refuses group or other permissions", async () => {
  assert.equal(await readKey(keyFile("abcdefgh", 0o644)), null);
  assert.equal(await readKey(keyFile("abcdefgh", 0o640)), null);
});

test("refuses short values, newlines and symlinks", async () => {
  assert.equal(await readKey(keyFile("short")), null);
  assert.equal(await readKey(keyFile("abcdefgh\nijkl")), null);
  const target = keyFile("abcdefgh");
  const link = join(mkdtempSync(join(tmpdir(), "key-link-")), "link");
  symlinkSync(target, link);
  assert.equal(await readKey(link), null);
});

test("refuses missing files", async () => {
  assert.equal(await readKey(join(tmpdir(), "does-not-exist-key")), null);
});
