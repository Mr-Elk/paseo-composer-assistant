import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Ordinary host-side JSON, not a credential vault: the key lives in a file the user chooses and
 * the server reads it per request. Nothing here is required for the plugin to load.
 */
export const assistantSettings = defineSettings({
  id: "assistant",
  scope: "host",
  version: 1,
  schema: z.object({
    baseUrl: z.string().default(""),
    model: z.string().default(""),
    keyFile: z.string().default(""),
    timeoutMs: z.number().int().min(1000).max(120000).default(30000),
    maxChars: z.number().int().min(1).max(20000).default(4000),
    protectedTerms: z.array(z.string()).default([]),
    continuation: z.boolean().default(false),
    continuationMinChars: z.number().int().min(4).max(500).default(12),
    autoLimitPerHour: z.number().int().min(0).max(60).default(10),
    nextSuggestion: z.boolean().default(false),
  }),
});
