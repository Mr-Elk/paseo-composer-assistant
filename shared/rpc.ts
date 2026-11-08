import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const optimizeRpc = defineRpc({
  name: "assistant.optimize",
  input: z.object({
    requestId: z.string().min(1).max(100),
    text: z.string().min(1).max(20000),
    mode: z.enum(["selection", "draft"]),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      suggestion: z.string().min(1),
      usage: z
        .object({
          inputTokens: z.number().optional(),
          outputTokens: z.number().optional(),
        })
        .optional(),
    }),
    z.object({
      ok: z.literal(false),
      reason: z.enum([
        "not-configured",
        "key-unavailable",
        "too-long",
        "request-failed",
        "empty",
      ]),
      message: z.string(),
    }),
  ]),
});

export const continueRpc = defineRpc({
  name: "assistant.continue",
  input: z.object({
    requestId: z.string().min(1).max(100),
    text: z.string().min(1).max(20000),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      suggestion: z.string().min(1),
      usage: z
        .object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() })
        .optional(),
    }),
    z.object({
      ok: z.literal(false),
      reason: z.enum([
        "disabled",
        "limit",
        "budget-unavailable",
        "not-configured",
        "key-unavailable",
        "too-long",
        "request-failed",
        "empty",
      ]),
      message: z.string(),
    }),
  ]),
});

export const nextRpc = defineRpc({
  name: "assistant.next",
  input: z.object({
    requestId: z.string().min(1).max(100),
    assistantText: z.string().min(1).max(8000),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({
      ok: z.literal(true),
      suggestion: z.string().min(1),
      usage: z
        .object({ inputTokens: z.number().optional(), outputTokens: z.number().optional() })
        .optional(),
    }),
    z.object({
      ok: z.literal(false),
      reason: z.enum([
        "disabled",
        "limit",
        "budget-unavailable",
        "not-configured",
        "key-unavailable",
        "too-long",
        "request-failed",
        "empty",
      ]),
      message: z.string(),
    }),
  ]),
});

export const cancelRpc = defineRpc({
  name: "assistant.cancel",
  input: z.object({ requestId: z.string().min(1).max(100) }),
  output: z.object({ canceled: z.boolean() }),
});
