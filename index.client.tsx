import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { PatchComposerBridge } from "./shared/host-bridge";
import { Assistant } from "./client/assistant";
import { AutoContinuation } from "./client/auto";
import { NextSuggestion } from "./client/next";
import { AssistantSettings } from "./client/settings-screen";

/**
 * The manual rewrite needs the drafted text and a safe write-back, so the pill only appears on a
 * host that carries the local composer bridge. Official 0.15.x cannot edit the draft.
 */
export default function contribute(client: PluginClientContext) {
  const bridge: PatchComposerBridge | undefined = client.composer;
  if (!bridge) return () => {};

  client.addSettingsScreen({
    id: "assistant",
    title: "输入助手",
    icon: "Sparkles",
    Component: AssistantSettings,
  });

  const registrations = new Map<string, () => void>();
  let stopped = false;
  let syncTimer: ReturnType<typeof setTimeout> | null = null;

  const sync = async () => {
    if (stopped) return;
    let agents: { id: string; workspaceId: string | null }[];
    try {
      const { entries } = await client.paseo.agents.list({});
      agents = entries
        .map((entry) => entry.agent)
        .filter((agent) => agent.status !== "closed" && Boolean(agent.workspaceId))
        .map((agent) => ({ id: agent.id, workspaceId: agent.workspaceId ?? null }));
    } catch {
      return;
    }
    if (stopped) return;
    const active = new Map(agents.map((agent) => [agent.id, agent]));
    for (const [id, cleanup] of registrations) {
      if (!active.has(id)) {
        cleanup();
        registrations.delete(id);
      }
    }
    for (const agent of agents) {
      if (registrations.has(agent.id) || !agent.workspaceId) continue;
      const cleanups: (() => void)[] = [];
      try {
      const workspaceId = agent.workspaceId;
      if (client.addComposerStatus) {
        const status = client.addComposerStatus({
          id: "auto-continuation",
          workspaceId,
          agentId: agent.id,
          Component: (props) => (
            <AutoContinuation
              bridge={bridge}
              agentId={props.agentId}
              workspaceId={props.workspaceId}
              theme={{ colors: { surface0: props.theme.colors.surface0, foregroundMuted: props.theme.colors.foregroundMuted } }}
            />
          ),
        });
        cleanups.push(() => status.remove());
      }
      if (client.addComposerStatus) {
        const nextStatus = client.addComposerStatus({
          id: "next-suggestion",
          workspaceId,
          agentId: agent.id,
          Component: (props) => (
            <NextSuggestion
              bridge={bridge}
              hostId={props.host.id}
              agentId={props.agentId}
              workspaceId={props.workspaceId}
              theme={{ colors: { surface0: props.theme.colors.surface0, foregroundMuted: props.theme.colors.foregroundMuted } }}
            />
          ),
        });
        cleanups.push(() => nextStatus.remove());
      }
      const pill = client.addComposerPill({
        id: "assistant",
        workspaceId,
        agentId: agent.id,
        button: {
          title: "优化草稿",
          icon: "Sparkles",
          label: "优化",
          behavior: {
            kind: "popover",
            Content: (props) => (
              <Assistant
                bridge={bridge}
                agentId={agent.id}
                workspaceId={workspaceId}
                openSettings={() => client.openSettings("assistant")}
                theme={props.theme}
                layout={props.layout}
              />
            ),
          },
        },
      });
      cleanups.push(() => pill.remove());
      registrations.set(agent.id, () => {
        for (const cleanup of cleanups) cleanup();
      });
      } catch (error) {
        for (const cleanup of cleanups) cleanup();
        console.warn("[assistant] registration failed", agent.id, String(error));
      }
    }
  };

  const scheduleSync = () => {
    if (stopped || syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void sync();
    }, 1500);
  };

  void sync();
  const unsubscribe = client.paseo.agents.subscribe(() => scheduleSync());
  const poll = setInterval(() => void sync(), 15000);

  return () => {
    stopped = true;
    unsubscribe();
    clearInterval(poll);
    if (syncTimer) clearTimeout(syncTimer);
    for (const cleanup of registrations.values()) cleanup();
    registrations.clear();
  };
}
