import type { PatchComposerSnapshot } from "./host-bridge.ts";

/** A suggestion is valid only for the same mounted editor and unchanged editing state. */
export function sameDraft(
  before: PatchComposerSnapshot | null,
  current: PatchComposerSnapshot | null,
): boolean {
  return Boolean(
    before && current &&
      before.workspaceId === current.workspaceId &&
      before.agentId === current.agentId &&
      before.draftId === current.draftId &&
      before.revision === current.revision &&
      before.text === current.text &&
      before.selection.start === current.selection.start &&
      before.selection.end === current.selection.end &&
      before.attachments === current.attachments &&
      before.editable && current.editable &&
      before.ime === "idle" && current.ime === "idle",
  );
}

export interface ContinuationContext {
  enabled: boolean;
  editable: boolean;
  ime: "idle" | "composing" | "unknown";
  busy: boolean;
  text: string;
  minChars: number;
  lastDismissedText: string | null;
}

/**
 * Continuation is offered only after a finished sentence, so typing does not trigger a request on
 * every pause. Disabled by default at the settings level.
 */
export function shouldOfferContinuation(input: ContinuationContext): boolean {
  if (!input.enabled || !input.editable || input.busy) return false;
  if (input.ime !== "idle") return false;
  const text = input.text.trim();
  if (text.length < input.minChars) return false;
  if (input.lastDismissedText !== null && text === input.lastDismissedText.trim()) return false;
  return /[。！？.!?…]$/.test(text);
}

/** Offers the next-message draft only once per assistant reply and only while idle. */
export function shouldSuggestNext(input: {
  enabled: boolean;
  status: string;
  handledBasis: number | null;
  basis: number;
}): boolean {
  return input.enabled && input.status === "idle" && input.handledBasis !== input.basis;
}
