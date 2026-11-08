import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AutoBudget, pruneWindow } from "./budget.ts";

const HOUR = 60 * 60 * 1000;

test("prunes timestamps outside the rolling window", () => {
  const now = 10 * HOUR;
  assert.deepEqual(pruneWindow([now - HOUR - 1, now - 10, now + 5], now), [now - 10, now + 5]);
});

test("allows up to the limit and then refuses", async () => {
  const dir = mkdtempSync(join(tmpdir(), "budget-"));
  const file = join(dir, "budget.json");
  let now = HOUR;
  const budget = new AutoBudget(file, () => now);
  for (let index = 0; index < 2; index += 1) {
    const result = await budget.take(2);
    assert.equal(result.allowed, true);
  }
  const refused = await budget.take(2);
  assert.equal(refused.allowed, false);
  assert.equal(refused.snapshot.remaining, 0);
  now += HOUR + 1;
  const afterWindow = await budget.take(2);
  assert.equal(afterWindow.allowed, true);
});

test("writes only timestamps to the file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "budget-"));
  const file = join(dir, "budget.json");
  const budget = new AutoBudget(file, () => HOUR);
  await budget.take(10);
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(Array.isArray(parsed.timestamps), true);
  assert.equal(Object.keys(parsed).length, 1);
});

test("refuses automatic requests when the counter file is corrupt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "budget-"));
  const file = join(dir, "budget.json");
  writeFileSync(file, "not json");
  const budget = new AutoBudget(file, () => HOUR);
  const result = await budget.take(5);
  assert.equal(result.allowed, false);
});

test("refuses automatic requests when valid JSON lacks the counter", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "budget-malformed-"));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "budget.json");
  writeFileSync(file, "{}");
  const result = await new AutoBudget(file).take(1);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "unavailable");
});

test("shares the limit across independent instances using the same file", async (context) => {
  const dir = mkdtempSync(join(tmpdir(), "budget-concurrent-"));
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "budget.json");
  const results = await Promise.all(
    Array.from({ length: 12 }, () => new AutoBudget(file).take(1)),
  );
  assert.equal(results.filter((result) => result.allowed).length, 1);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).timestamps.length, 1);
});

test("works without a file for tests and hosts without storage", async () => {
  const budget = new AutoBudget(null, () => HOUR);
  assert.equal((await budget.take(1)).allowed, true);
  assert.equal((await budget.take(1)).allowed, false);
});
