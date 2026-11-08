import type { PluginServerContext } from "@getpaseo/plugin/server";
import { homedir } from "node:os";
import { join } from "node:path";
import { AutoBudget } from "./server/budget";
import { Requests } from "./server/requests";
import { continueText, isKeyUsable, optimizeText, suggestNext, type AssistantConfig } from "./server/model";
import { assistantSettings } from "./shared/settings";
import { cancelRpc, continueRpc, nextRpc, optimizeRpc } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(assistantSettings);
  const requests = new Requests();
  const budget = new AutoBudget(join(homedir(), ".paseo-composer-assistant", "auto-budget.json"));
  const cancelled = { ok: false as const, reason: "request-failed" as const, message: "已取消；草稿没有改动。" };
  async function withRequest<T>(requestId: string, work: (signal: AbortSignal) => Promise<T>) {
    const controller = requests.begin(requestId);
    if (!controller) return { ok: false as const, reason: "request-failed" as const, message: "请求暂不可用，未发送。" };
    try {
      if (controller.signal.aborted) return cancelled;
      const result = await work(controller.signal);
      return controller.signal.aborted ? cancelled : result;
    } finally {
      requests.finish(requestId, controller);
    }
  }
  server.handle(cancelRpc, async (input) => {
    return { canceled: requests.cancel(input.requestId) };
  });
  server.handle(continueRpc, async (input) => withRequest(input.requestId, async (signal) => {
    const state = await settings.read();
    if (signal.aborted) return cancelled;
    if (state.status !== "ready") {
      return { ok: false as const, reason: "disabled" as const, message: "自动续写设置无法读取。" };
    }
    const values = state.values;
    if (!values.continuation) {
      return { ok: false as const, reason: "disabled" as const, message: "自动续写未开启。" };
    }
    if (!values.baseUrl.trim() || !values.model.trim() || !values.keyFile.trim()) {
      return { ok: false as const, reason: "not-configured" as const, message: "还没有配置辅助模型。" };
    }
    if (!(await isKeyUsable(values.keyFile))) {
      return {
        ok: false as const,
        reason: "key-unavailable" as const,
        message: "读不到可用的密钥文件；没有自动请求。",
      };
    }
    if (signal.aborted) return cancelled;
    const reservation = await budget.take(values.autoLimitPerHour);
    if (signal.aborted) return cancelled;
    if (!reservation.allowed) {
      return {
        ok: false as const,
        reason: reservation.reason === "unavailable" ? "budget-unavailable" as const : "limit" as const,
        message: reservation.reason === "unavailable"
          ? "自动建议计数暂不可用，已停止自动请求。"
          : `自动建议已达每小时上限（${values.autoLimitPerHour} 次）。`,
      };
    }
    return continueText({ text: input.text, config: values as AssistantConfig, signal });
  }));
  server.handle(nextRpc, async (input) => withRequest(input.requestId, async (signal) => {
    const state = await settings.read();
    if (signal.aborted) return cancelled;
    if (state.status !== "ready") {
      return { ok: false as const, reason: "disabled" as const, message: "下一句建议设置无法读取。" };
    }
    const values = state.values;
    if (!values.nextSuggestion) {
      return { ok: false as const, reason: "disabled" as const, message: "下一句建议未开启。" };
    }
    if (!values.baseUrl.trim() || !values.model.trim() || !values.keyFile.trim()) {
      return { ok: false as const, reason: "not-configured" as const, message: "还没有配置辅助模型。" };
    }
    if (!(await isKeyUsable(values.keyFile))) {
      return {
        ok: false as const,
        reason: "key-unavailable" as const,
        message: "读不到可用的密钥文件；没有自动请求。",
      };
    }
    if (signal.aborted) return cancelled;
    const reservation = await budget.take(values.autoLimitPerHour);
    if (signal.aborted) return cancelled;
    if (!reservation.allowed) {
      return {
        ok: false as const,
        reason: reservation.reason === "unavailable" ? "budget-unavailable" as const : "limit" as const,
        message: reservation.reason === "unavailable"
          ? "自动建议计数暂不可用，已停止自动请求。"
          : `自动建议已达每小时上限（${values.autoLimitPerHour} 次）。`,
      };
    }
    return suggestNext({ assistantText: input.assistantText, config: values as AssistantConfig, signal });
  }));
  server.handle(optimizeRpc, async (input) => withRequest(input.requestId, async (signal) => {
    const state = await settings.read();
    if (signal.aborted) return cancelled;
    if (state.status !== "ready") {
      return {
        ok: false as const,
        reason: "not-configured" as const,
        message: "辅助模型设置无法读取；草稿没有改动。",
      };
    }
    return optimizeText({ text: input.text, config: state.values as AssistantConfig, signal });
  }));
  return () => requests.stop();
}
