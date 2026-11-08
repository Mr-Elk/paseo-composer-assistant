import assert from "node:assert/strict";
import { test } from "node:test";
import { sameDraft, shouldOfferContinuation, shouldSuggestNext } from "./auto.ts";
import type { PatchComposerSnapshot } from "./host-bridge.ts";

const base = {
  enabled: true,
  editable: true,
  ime: "idle" as const,
  busy: false,
  text: "今天的进度已经整理好了。",
  minChars: 12,
  lastDismissedText: null,
};

test("offers only after a finished sentence with enough text", () => {
  assert.equal(shouldOfferContinuation(base), true);
  assert.equal(shouldOfferContinuation({ ...base, text: "今天的进度已经整理好了" }), false);
  assert.equal(shouldOfferContinuation({ ...base, text: "太短。" }), false);
});

test("respects the switch, composition, editability and dismissal", () => {
  assert.equal(shouldOfferContinuation({ ...base, enabled: false }), false);
  assert.equal(shouldOfferContinuation({ ...base, ime: "composing" }), false);
  assert.equal(shouldOfferContinuation({ ...base, editable: false }), false);
  assert.equal(shouldOfferContinuation({ ...base, busy: true }), false);
  assert.equal(shouldOfferContinuation({ ...base, lastDismissedText: base.text }), false);
});

test("suggests the next message once per assistant reply while idle", () => {
  const base = { enabled: true, status: "idle", handledBasis: null, basis: 7 };
  assert.equal(shouldSuggestNext(base), true);
  assert.equal(shouldSuggestNext({ ...base, status: "running" }), false);
  assert.equal(shouldSuggestNext({ ...base, enabled: false }), false);
  assert.equal(shouldSuggestNext({ ...base, handledBasis: 7 }), false);
});

test("invalidates a suggestion when the editor, text, selection or input state changes", () => {
  const snapshot: PatchComposerSnapshot = {
    workspaceId: "workspace", agentId: "agent", draftId: "mount-1", revision: 3,
    text: "草稿。", selection: { start: 0, end: 2 }, ime: "idle", attachments: 0, editable: true,
  };
  assert.equal(sameDraft(snapshot, { ...snapshot }), true);
  for (const changed of [
    { ...snapshot, draftId: "mount-2" },
    { ...snapshot, revision: 4 },
    { ...snapshot, text: "新草稿。" },
    { ...snapshot, selection: { start: 1, end: 2 } },
    { ...snapshot, ime: "composing" as const },
    { ...snapshot, ime: "unknown" as const },
    { ...snapshot, editable: false },
    { ...snapshot, attachments: 1 },
    { ...snapshot, agentId: "other" },
    { ...snapshot, workspaceId: "other" },
    null,
  ]) assert.equal(sameDraft(snapshot, changed), false);
});
