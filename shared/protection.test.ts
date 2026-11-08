import assert from "node:assert/strict";
import { test } from "node:test";
import { extractProtected, verifyProtected } from "./protection.ts";

test("protects fenced code, inline code, urls and paths", () => {
  const text = "跑 `npm test`，然后看 https://example.com/docs 和 /tmp/project/README.md。\n```ts\nconst a = 1;\n```";
  const values = extractProtected(text).map((segment) => segment.value);
  assert.ok(values.includes("`npm test`"));
  assert.ok(values.includes("https://example.com/docs"));
  assert.ok(values.includes("/tmp/project/README.md"));
  assert.ok(values.some((value) => value.startsWith("```ts")));
});

test("keeps user terms protected too", () => {
  const segments = extractProtected("请保留示例术语这个词。", ["示例术语"]);
  assert.ok(segments.some((segment) => segment.kind === "term" && segment.value === "示例术语"));
});

test("accepts a suggestion that keeps every protected segment", () => {
  const original = "把 `npm test` 跑一下，结果写到 /tmp/report.md。";
  const suggestion = "请运行 `npm test`，并把结果保存到 /tmp/report.md。";
  assert.deepEqual(verifyProtected({ original, suggestion }), { ok: true });
});

test("rejects a suggestion that dropped or changed protected text", () => {
  const original = "把 `npm test` 跑一下，结果写到 /tmp/report.md。";
  const suggestion = "请运行测试，并把结果保存到报告文件。";
  const result = verifyProtected({ original, suggestion });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.missing.length, 2);
  }
});

test("does not treat an ordinary slash as a path", () => {
  assert.deepEqual(extractProtected("用 / 分隔两个选项"), []);
});
