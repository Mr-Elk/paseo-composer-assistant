import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { sameDraft, shouldOfferContinuation } from "../shared/auto";
import type { PatchComposerBridge, PatchComposerSnapshot } from "../shared/host-bridge";
import { cancelRpc, continueRpc } from "../shared/rpc";
import { assistantSettings } from "../shared/settings";

type Suggestion = {
  text: string;
  base: PatchComposerSnapshot;
};

const DEBOUNCE_MS = 1800;

export function AutoContinuation(input: {
  bridge: PatchComposerBridge;
  agentId: string;
  workspaceId: string;
  theme: { colors: { surface0: string; foregroundMuted: string } };
}) {
  const { bridge, agentId, workspaceId, theme } = input;
  const target = { workspaceId, agentId };
  const settings = useSettings(assistantSettings);
  const request = useRpc(continueRpc);
  const cancel = useRpc(cancelRpc);
  const [snapshot, setSnapshot] = useState<PatchComposerSnapshot | null>(() => bridge.read(target));
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const pendingBaseRef = useRef<PatchComposerSnapshot | null>(null);

  const enabled = settings.status === "ready" && settings.values.continuation;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const minChars = settings.status === "ready" ? settings.values.continuationMinChars : 12;
  const draftText = snapshot?.text ?? "";
  const draftIme = snapshot?.ime ?? "unknown";
  const draftEditable = snapshot?.editable ?? false;

  useEffect(() => bridge.subscribe(target, setSnapshot), [bridge, workspaceId, agentId]);

  // A change to the editor, selection or input state invalidates the earlier suggestion.
  useEffect(() => {
    if (suggestion && (!enabled || !sameDraft(suggestion.base, bridge.read(target)))) {
      setDismissed(suggestion.base.text);
      setSuggestion(null);
    }
    const pending = pendingBaseRef.current;
    const requestId = requestIdRef.current;
    if (pending && requestId && (!enabled || !sameDraft(pending, bridge.read(target)))) {
      requestIdRef.current = null;
      pendingBaseRef.current = null;
      setDismissed(pending.text);
      setBusy(false);
      void cancel({ requestId }).catch(() => undefined);
    }
  }, [bridge, cancel, enabled, snapshot, suggestion, workspaceId, agentId]);

  const ask = useCallback(
    async (text: string) => {
      const current = bridge.read(target);
      if (!enabledRef.current || !current || current.text !== text || !sameDraft(current, current)) return;
      const base = { ...current, selection: { ...current.selection } };
      const requestId =
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      requestIdRef.current = requestId;
      pendingBaseRef.current = base;
      setBusy(true);
      setNotice(null);
      try {
        const result = await request({ requestId, text });
        if (requestIdRef.current !== requestId || !enabledRef.current) return;
        if (!result.ok) {
          // Do not retry the same draft after a failure; a new draft may try again.
          setDismissed(text);
          if (result.reason === "limit" || result.reason === "budget-unavailable") setNotice(result.message);
          return;
        }
        if (!sameDraft(base, bridge.read(target))) {
          setDismissed(text);
          return;
        }
        setSuggestion({ text: result.suggestion, base });
      } catch {
        if (requestIdRef.current === requestId) setDismissed(text);
      } finally {
        if (requestIdRef.current === requestId) {
          setBusy(false);
          requestIdRef.current = null;
          pendingBaseRef.current = null;
        }
      }
    },
    [bridge, request, target.workspaceId, target.agentId],
  );

  useEffect(() => {
    if (!enabled || suggestion || busy) return;
    if (
      !shouldOfferContinuation({
        enabled,
        editable: draftEditable,
        ime: draftIme,
        busy,
        text: draftText,
        minChars,
        lastDismissedText: dismissed,
      })
    ) {
      return;
    }
    const timer = setTimeout(() => void ask(draftText), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    enabled,
    draftText,
    draftIme,
    draftEditable,
    suggestion,
    busy,
    minChars,
    dismissed,
    ask,
  ]);

  useEffect(
    () => () => {
      const pending = requestIdRef.current;
      requestIdRef.current = null;
      pendingBaseRef.current = null;
      if (pending) void cancel({ requestId: pending }).catch(() => undefined);
    },
    [cancel],
  );

  if (!enabled) return null;

  const adopt = () => {
    if (!suggestion) return;
    const current = bridge.read(target);
    if (!sameDraft(suggestion.base, current)) {
      setSuggestion(null);
      setNotice("草稿或选区已变化，续写没有写入。");
      return;
    }
    const needsSpace = /[A-Za-z0-9]$/.test(suggestion.base.text) && /^[A-Za-z0-9]/.test(suggestion.text);
    const replacement = needsSpace ? ` ${suggestion.text}` : suggestion.text;
    const result = bridge.apply(target, {
      draftId: suggestion.base.draftId,
      revision: suggestion.base.revision,
      range: { start: suggestion.base.text.length, end: suggestion.base.text.length },
      expectedText: "",
      replacement,
    });
    if (result.ok) {
      const nextText = `${suggestion.base.text}${replacement}`;
      setDismissed(nextText);
      setSuggestion(null);
      setNotice("已续写，没有发送。");
      return;
    }
    setNotice(
      result.reason === "stale" || result.reason === "mismatch"
        ? "草稿已变化，续写没有写入。"
        : "续写没有写入。",
    );
  };

  const ignore = () => {
    setDismissed(suggestion?.base.text ?? null);
    setSuggestion(null);
    setNotice(null);
  };

  const buttonStyle = {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "#222",
  };
  const buttonText = { color: "#fff", fontSize: 11 };

  if (!suggestion && !busy && !notice) return null;
  return (
    <View style={{ paddingHorizontal: 4, paddingVertical: 2, gap: 6 }}>
      {busy ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>续写中…</Text>
      ) : null}
      {suggestion ? (
        <>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }} numberOfLines={2}>
            续写：{suggestion.text}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={adopt} style={buttonStyle}>
              <Text style={buttonText}>采纳续写</Text>
            </Pressable>
            <Pressable onPress={ignore} style={buttonStyle}>
              <Text style={buttonText}>忽略</Text>
            </Pressable>
          </View>
        </>
      ) : null}
      {notice ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{notice}</Text>
      ) : null}
    </View>
  );
}
