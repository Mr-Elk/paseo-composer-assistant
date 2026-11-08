/**
 * The optional composer API that exists only on Paseo hosts carrying the local bridge patch.
 * Official 0.15.x leaves both members undefined, so every caller checks before using them.
 *
 * Shared code cannot import react or the client runtime, so the component shape stays structural.
 */
export type PatchComponent<P> = (props: P) => unknown;

export interface PatchHostProps {
  theme: {
    colors: {
      readonly surface0: string;
      readonly foreground: string;
      readonly foregroundMuted: string;
    };
  };
  host: { readonly id: string; readonly label: string };
  layout: { readonly compact: boolean; readonly platform: "ios" | "android" | "web" };
}

export interface PatchComposerTarget {
  workspaceId: string;
  agentId: string;
}

export interface PatchComposerSnapshot {
  workspaceId: string;
  agentId: string;
  draftId: string;
  revision: number;
  text: string;
  selection: { start: number; end: number };
  ime: "idle" | "composing" | "unknown";
  attachments: number;
  editable: boolean;
}

export interface PatchComposerEdit {
  draftId: string;
  revision: number;
  range: { start: number; end: number };
  expectedText: string;
  replacement: string;
}

export type PatchComposerEditResult =
  | { ok: true; revision: number; undoable: boolean }
  | { ok: false; reason: "unavailable" | "stale" | "mismatch" | "ime" | "read-only" };

export interface PatchComposerBridge {
  readonly version: 1;
  read(target: PatchComposerTarget): PatchComposerSnapshot | null;
  subscribe(
    target: PatchComposerTarget,
    listener: (snapshot: PatchComposerSnapshot | null) => void,
  ): () => void;
  apply(target: PatchComposerTarget, edit: PatchComposerEdit): PatchComposerEditResult;
}

export interface PatchComposerStatusProps extends PatchHostProps {
  workspaceId: string;
  agentId: string;
}

export interface PatchComposerStatusContribution {
  id: string;
  workspaceId: string;
  agentId: string;
  Component: PatchComponent<PatchComposerStatusProps>;
}

declare module "@getpaseo/plugin/client" {
  interface PluginClientContext {
    readonly composer?: PatchComposerBridge;
    readonly addComposerStatus?: (contribution: PatchComposerStatusContribution) => {
      update(patch: { Component?: PatchComponent<PatchComposerStatusProps> }): void;
      remove(): void;
    };
  }
}

export {};
