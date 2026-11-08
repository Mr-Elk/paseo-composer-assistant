import assert from "node:assert/strict";
import { test } from "node:test";
import { Requests } from "./requests.ts";

test("a cancellation received before the request prevents it from starting", () => {
  const requests = new Requests();
  assert.equal(requests.cancel("early"), true);
  const controller = requests.begin("early");
  assert.ok(controller);
  assert.equal(controller.signal.aborted, true);
});

test("cancel aborts an active request and a completed request cannot be cancelled", () => {
  const requests = new Requests();
  const controller = requests.begin("active");
  assert.ok(controller);
  assert.equal(requests.begin("active"), null);
  assert.equal(requests.cancel("active"), true);
  assert.equal(controller.signal.aborted, true);
  requests.finish("active", controller);
  assert.equal(requests.cancel("active"), false);
});

test("stopping the plugin aborts all active requests", () => {
  const requests = new Requests();
  const first = requests.begin("one");
  const second = requests.begin("two");
  assert.ok(first && second);
  requests.stop();
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);
});
