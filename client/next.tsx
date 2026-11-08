import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useAgent, usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import type { PatchComposerBridge, PatchComposerSnapshot } from "../shared/host-bridge";
import { sameDraft, shouldSuggestNext } from "../shared/auto";
import { assistantSettings } from "../shared/settings";
import { cancelRpc, nextRpc } from "../shared/rpc";

type Suggestion = {
  text: string;
  basis: number;
  base: PatchComposerSnapshot;
};

/** Remembers which assistant reply already produced a suggestion, across panel remounts. */
const handledBasisByAgent = new Map<string, number>();

const EDIT_FAILURE: Record<string, string> = {
  unavailable: "输入框已关闭，下一句没有写入。",
  stale: "草稿已经变化，下一句没有写入。",
  mismatch: "原文对不上，下一句没有写入。",
  ime: "输入法正在组字，下一句没有写入。",
  "read-only": "输入框当前不可编辑，下一句没有写入。",
};

/**
 * After a turn finishes, drafts the user's next message from the assistant's last reply. The
 * suggestion is only shown when the user enabled it; adopting inserts text into the composer and
 * never sends.
 */
export function NextSuggestion(input: {
  bridge: PatchComposerBridge;
  hostId: string;
  agentId: string;
  workspaceId: string;
  theme: { colors: { surface0: string; foregroundMuted: string } };
}) {
  const { bridge, hostId, agentId, workspaceId, theme } = input;
  const target = { workspaceId, agentId };
  const identity = `${hostId}\u0000${workspaceId}\u0000${agentId}`;
  const settings = useSettings(assistantSettings);
  const paseo = usePaseo();
  const status = useAgent(agentId, (snapshot) => snapshot.status);
  const request = useRpc(nextRpc);
  const cancel = useRpc(cancelRpc);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [snapshot, setSnapshot] = useState<PatchComposerSnapshot | null>(() => bridge.read(target));
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const handledRef = useRef<number | null>(handledBasisByAgent.get(identity) ?? null);
  const fetchingRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const pendingBaseRef = useRef<PatchComposerSnapshot | null>(null);
  const generationRef = useRef(0);
  const observedRunningRef = useRef(false);
  const previousStatusRef = useRef<string | null>(null);

  const enabled = settings.status === "ready" && settings.values.nextSuggestion;
  const enabledRef = useRef(enabled);
  const statusRef = useRef(status);
  enabledRef.current = enabled;
  statusRef.current = status;

  useEffect(() => bridge.subscribe(target, setSnapshot), [bridge, workspaceId, agentId]);

  useEffect(() => {
    handledRef.current = handledBasisByAgent.get(identity) ?? null;
    observedRunningRef.current = false;
    previousStatusRef.current = null;
  }, [identity]);

  useEffect(() => {
    const current = bridge.read(target);
    if (suggestion && (!enabled || status !== "idle" || !sameDraft(suggestion.base, current))) {
      setSuggestion(null);
    }
    const pending = pendingBaseRef.current;
    if ((pending && (!enabled || status !== "idle" || !sameDraft(pending, current))) ||
        (!pending && fetchingRef.current && (!enabled || status !== "idle"))) {
      generationRef.current += 1;
      fetchingRef.current = false;
      pendingBaseRef.current = null;
      const requestId = requestIdRef.current;
      requestIdRef.current = null;
      setBusy(false);
      if (requestId) void cancel({ requestId }).catch(() => undefined);
    }
  }, [agentId, bridge, cancel, enabled, snapshot, status, suggestion, workspaceId]);

  const load = useCallback(async (currentStatus: string) => {
    if (!enabled || fetchingRef.current) return;
    const current = bridge.read(target);
    if (!sameDraft(current, current) || !current) return;
    const base = { ...current, selection: { ...current.selection } };
    const generation = ++generationRef.current;
    fetchingRef.current = true;
    pendingBaseRef.current = base;
    try {
      const handle = paseo.agents.ref(agentId);
      const page = await handle.timeline.refetch({ direction: "tail", limit: 8 });
      const last = [...page.entries]
        .reverse()
        .find((entry) => entry.item.type === "assistant_message" && entry.item.text.trim());
      if (!last || last.item.type !== "assistant_message") return;
      if (generationRef.current !== generation || !enabledRef.current || statusRef.current !== "idle" ||
          !sameDraft(base, bridge.read(target))) return;
      const basis = last.seqEnd;
      if (
        !shouldSuggestNext({
          enabled,
          status: currentStatus,
          handledBasis: handledRef.current,
          basis,
        })
      ) {
        return;
      }
      setBusy(true);
      const requestId =
        globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      requestIdRef.current = requestId;
      const limit = settings.status === "ready" ? Math.min(settings.values.maxChars, 8000) : 4000;
      const result = await request({
        requestId,
        assistantText: last.item.text.slice(0, limit),
      });
      if (generationRef.current !== generation || requestIdRef.current !== requestId ||
          !enabledRef.current || statusRef.current !== "idle" || !sameDraft(base, bridge.read(target))) return;
      handledBasisByAgent.set(identity, basis);
      handledRef.current = basis;
      if (!result.ok) {
        if (result.reason === "limit" || result.reason === "budget-unavailable") setNotice(result.message);
        return;
      }
      setSuggestion({ text: result.suggestion, basis, base });
    } catch {
      // A failed automatic request stays silent; the manual button reports its own errors.
    } finally {
      if (generationRef.current === generation) {
        fetchingRef.current = false;
        pendingBaseRef.current = null;
        setBusy(false);
        requestIdRef.current = null;
      }
    }
  }, [agentId, bridge, enabled, identity, paseo, request, settings, workspaceId]);

  // Remember the reply that existed on mount without spending a model request; only a turn that
  // finishes while this panel is open can trigger a suggestion.
  const rememberOnly = useCallback(async () => {
    if (fetchingRef.current) return;
    const generation = ++generationRef.current;
    fetchingRef.current = true;
    try {
      const page = await paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: 8 });
      const last = [...page.entries]
        .reverse()
        .find((entry) => entry.item.type === "assistant_message" && entry.item.text.trim());
      if (last && generationRef.current === generation && enabledRef.current && statusRef.current === "idle") {
        handledRef.current = last.seqEnd;
        handledBasisByAgent.set(identity, last.seqEnd);
      }
    } catch {
      // Nothing remembered; the next finished turn still triggers once.
    } finally {
      if (generationRef.current === generation) fetchingRef.current = false;
    }
  }, [agentId, identity, paseo]);

  useEffect(() => {
    if (!enabled) {
      observedRunningRef.current = false;
      previousStatusRef.current = null;
      return;
    }
    const previous = previousStatusRef.current;
    previousStatusRef.current = status ?? null;
    if (status === "running") {
      observedRunningRef.current = true;
      return;
    }
    if (status !== "idle") {
      observedRunningRef.current = false;
      return;
    }
    if (!observedRunningRef.current) {
      if (previous === null) void rememberOnly();
      return;
    }
    observedRunningRef.current = false;
    void load("idle");
  }, [enabled, status, load, rememberOnly]);

  useEffect(
    () => () => {
      const pending = requestIdRef.current;
      generationRef.current += 1;
      fetchingRef.current = false;
      pendingBaseRef.current = null;
      requestIdRef.current = null;
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
      setNotice("草稿或选区已变化，下一句没有写入。");
      return;
    }
    const replacement = suggestion.base.text.trim()
      ? (/[A-Za-z0-9]$/.test(suggestion.base.text) && /^[A-Za-z0-9]/.test(suggestion.text)
          ? ` ${suggestion.text}`
          : suggestion.text)
      : suggestion.text;
    const result = bridge.apply(target, {
      draftId: suggestion.base.draftId,
      revision: suggestion.base.revision,
      range: { start: suggestion.base.text.length, end: suggestion.base.text.length },
      expectedText: "",
      replacement,
    });
    if (result.ok) {
      setSuggestion(null);
      setNotice("已写入输入框，没有发送。");
      return;
    }
    setNotice(EDIT_FAILURE[result.reason] ?? "下一句没有写入。");
  };

  const ignore = () => {
    setSuggestion(null);
    setNotice(null);
  };

  if (!suggestion && !busy && !notice) return null;
  return (
    <View style={{ paddingHorizontal: 4, paddingVertical: 2, gap: 6 }}>
      {busy ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>想下一句…</Text>
      ) : null}
      {suggestion ? (
        <>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }} numberOfLines={2}>
            下一句：{suggestion.text}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={adopt} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: "#222" }}>
              <Text style={{ color: "#fff", fontSize: 11 }}>采纳下一句</Text>
            </Pressable>
            <Pressable onPress={ignore} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: "#222" }}>
              <Text style={{ color: "#fff", fontSize: 11 }}>忽略</Text>
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
