import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import type {
  PatchComposerBridge,
  PatchComposerSnapshot,
} from "../shared/host-bridge";
import { cancelRpc, optimizeRpc } from "../shared/rpc";
import { assistantSettings } from "../shared/settings";

type Suggestion = {
  text: string;
  mode: "selection" | "draft";
  draftId: string;
  revision: number;
  range: { start: number; end: number };
  expectedText: string;
};

const EDIT_FAILURE: Record<string, string> = {
  unavailable: "输入框已关闭或插件已停用，建议没有写回。",
  stale: "草稿已经变化，建议没有写回；请重新优化。",
  mismatch: "原文对不上，建议没有写回。",
  ime: "输入法正在组字，建议没有写回。",
  "read-only": "输入框当前不可编辑，建议没有写回。",
};

export function Assistant(input: {
  bridge: PatchComposerBridge;
  agentId: string;
  workspaceId: string;
  openSettings: () => void;
  theme: { colors: { surface0: string; foreground: string; foregroundMuted: string } };
  layout: { compact: boolean; platform: "ios" | "android" | "web" };
}) {
  const { bridge, agentId, workspaceId, theme, layout, openSettings } = input;
  const target = { workspaceId, agentId };
  const [snapshot, setSnapshot] = useState<PatchComposerSnapshot | null>(() => bridge.read(target));
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeRequestRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const optimize = useRpc(optimizeRpc);
  const cancel = useRpc(cancelRpc);
  const settings = useSettings(assistantSettings);

  const newRequestId = () =>
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  useEffect(
    () => () => {
      if (requestId) void cancel({ requestId }).catch(() => undefined);
    },
    [requestId, cancel],
  );

  useEffect(() => bridge.subscribe(target, setSnapshot), [bridge, workspaceId, agentId]);

  // Any draft or session change invalidates a suggestion made for the earlier version.
  useEffect(() => {
    if (!suggestion || !snapshot) return;
    if (snapshot.draftId !== suggestion.draftId || snapshot.revision !== suggestion.revision) {
      setSuggestion(null);
      setNotice("草稿或会话已变化，建议已失效；请重新优化。");
    }
  }, [snapshot, suggestion]);

  if (!snapshot) {
    return (
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, padding: 8 }}>
        输入框还没有准备好，暂时不能优化。
      </Text>
    );
  }

  const hasSelection = snapshot.selection.end > snapshot.selection.start;
  const selectedText = hasSelection
    ? snapshot.text.slice(snapshot.selection.start, snapshot.selection.end)
    : snapshot.text;

  const run = async () => {
    if (!snapshot.editable) {
      setNotice("输入框当前不可编辑。");
      return;
    }
    if (snapshot.ime !== "idle") {
      setNotice(
        snapshot.ime === "composing"
          ? "输入法正在组字，完成后再优化。"
          : "无法确认输入法状态，暂不优化。",
      );
      return;
    }
    const text = selectedText;
    if (!text.trim()) {
      setNotice("先写点文字再优化。");
      return;
    }
    const range = hasSelection
      ? { start: snapshot.selection.start, end: snapshot.selection.end }
      : { start: 0, end: snapshot.text.length };
    const nextRequestId = newRequestId();
    activeRequestRef.current = nextRequestId;
    setRequestId(nextRequestId);
    setBusy(true);
    setSuggestion(null);
    setNotice(null);
    try {
      const result = await optimize({
        requestId: nextRequestId,
        text,
        mode: hasSelection ? "selection" : "draft",
      });
      if (activeRequestRef.current !== nextRequestId) return;
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setSuggestion({
        text: result.suggestion,
        mode: hasSelection ? "selection" : "draft",
        draftId: snapshot.draftId,
        revision: snapshot.revision,
        range,
        expectedText: text,
      });
      if (result.usage?.outputTokens) {
        setNotice(`建议已生成；本次辅助输出约 ${result.usage.outputTokens} token。`);
      }
    } catch {
      if (activeRequestRef.current === nextRequestId) {
        setNotice("辅助请求没有完成；草稿没有改动。");
      }
    } finally {
      if (activeRequestRef.current === nextRequestId) {
        activeRequestRef.current = null;
        setBusy(false);
        setRequestId(null);
      }
    }
  };

  const cancelRun = async () => {
    if (!requestId) return;
    let canceled = false;
    try {
      const result = await cancel({ requestId });
      canceled = result.canceled;
    } catch {
      // The request may have already finished; the pending result still reports its own state.
    }
    if (canceled) {
      activeRequestRef.current = null;
      setRequestId(null);
      setBusy(false);
      setNotice("已取消；草稿没有改动。");
      return;
    }
    setNotice("请求已经结束，正在收尾。");
  };

  const adopt = () => {
    if (!suggestion) return;
    const result = bridge.apply(target, {
      draftId: suggestion.draftId,
      revision: suggestion.revision,
      range: suggestion.range,
      expectedText: suggestion.expectedText,
      replacement: suggestion.text,
    });
    if (result.ok) {
      setSuggestion(null);
      setNotice(
        result.undoable
          ? "已写回草稿，没有发送；可用 ⌘Z 撤回。"
          : "已写回草稿，没有发送；当前平台不支持撤回。",
      );
      return;
    }
    setNotice(EDIT_FAILURE[result.reason] ?? "建议没有写回。");
  };

  const keepOriginal = () => {
    setSuggestion(null);
    setNotice("已保留原文。");
  };

  const toggleAuto = async (key: "continuation" | "nextSuggestion") => {
    if (settings.status !== "ready" || settingsBusy) return;
    setSettingsBusy(true);
    try {
      const ok = await settings.save(
        { ...settings.values, [key]: !settings.values[key] },
        settings.revision,
      );
      setNotice(ok ? null : "设置没有保存，请重试。");
    } catch {
      setNotice("设置没有保存，请重试。");
    } finally {
      setSettingsBusy(false);
    }
  };

  const buttonStyle = {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: theme.colors.foreground,
  };
  const buttonText = { color: theme.colors.foregroundMuted, fontSize: 12 };

  return (
    <View style={{ padding: 10, gap: 8, minWidth: 260 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        {hasSelection ? `优化选中的 ${selectedText.length} 个字符` : `优化整段草稿（${snapshot.text.length} 个字符）`}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={run}
          disabled={busy}
          style={{ ...buttonStyle, opacity: busy ? 0.5 : 1 }}
        >
          <Text style={{ color: theme.colors.surface0, fontSize: 12 }}>
            {suggestion ? "重新优化" : "优化"}
          </Text>
        </Pressable>
        {busy ? (
          <Pressable onPress={cancelRun} style={buttonStyle}>
            <Text style={{ color: theme.colors.surface0, fontSize: 12 }}>取消</Text>
          </Pressable>
        ) : null}
      </View>
      {suggestion ? (
        <>
          <ScrollView style={{ maxHeight: 190 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
              {suggestion.text}
            </Text>
          </ScrollView>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={adopt} style={buttonStyle}>
              <Text style={{ color: theme.colors.surface0, fontSize: 12 }}>采纳建议</Text>
            </Pressable>
            <Pressable onPress={keepOriginal} style={buttonStyle}>
              <Text style={{ color: theme.colors.surface0, fontSize: 12 }}>保留原文</Text>
            </Pressable>
          </View>
        </>
      ) : null}
      {notice ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          {notice}
        </Text>
      ) : null}
      {settings.status === "ready" ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {([['continuation', '输入续写'], ['nextSuggestion', '回复后下一句']] as const).map(([key, label]) => (
              <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text style={buttonText}>{label}</Text>
                <Switch
                  accessibilityLabel={label}
                  disabled={settingsBusy}
                  value={settings.values[key]}
                  onValueChange={() => void toggleAuto(key)}
                />
              </View>
            ))}
            <Pressable accessibilityRole="button" onPress={openSettings}>
              <Text style={buttonText}>完整设置</Text>
            </Pressable>
          </View>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            开启后会发送草稿或助手回复给辅助模型，可能产生费用；每小时最多 {settings.values.autoLimitPerHour} 次。
          </Text>
        </View>
      ) : (
        <Pressable accessibilityRole="button" onPress={openSettings}>
          <Text style={buttonText}>完整设置</Text>
        </Pressable>
      )}
    </View>
  );
}
