import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsInput, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { assistantSettings } from "../shared/settings";

export function AssistantSettings() {
  const settings = useSettings(assistantSettings);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [keyFile, setKeyFile] = useState("");
  const [terms, setTerms] = useState("");
  const [maxChars, setMaxChars] = useState("4000");
  const [timeoutMs, setTimeoutMs] = useState("30000");
  const [continuation, setContinuation] = useState(false);
  const [minChars, setMinChars] = useState("12");
  const [autoLimit, setAutoLimit] = useState("10");
  const [nextSuggestion, setNextSuggestion] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const revision = settings.status === "ready" ? settings.revision : null;
  useEffect(() => {
    if (revision === null || settings.status !== "ready") return;
    setBaseUrl(settings.values.baseUrl);
    setModel(settings.values.model);
    setKeyFile(settings.values.keyFile);
    setTerms(settings.values.protectedTerms.join("、"));
    setMaxChars(String(settings.values.maxChars));
    setTimeoutMs(String(settings.values.timeoutMs));
    setContinuation(settings.values.continuation);
    setMinChars(String(settings.values.continuationMinChars));
    setAutoLimit(String(settings.values.autoLimitPerHour));
    setNextSuggestion(settings.values.nextSuggestion);
    setFormKey((current) => current + 1);
  }, [revision]);

  if (settings.status === "loading") {
    return <Text style={{ padding: 16 }}>读取设置…</Text>;
  }
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="辅助模型">
        <SettingsCard>
          <SettingsInput
            label="设置无法读取"
            initialValue={settings.error ?? ""}
            onChangeText={() => {}}
            disabled
          />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const numberOrDefault = (value: string, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const save = async () => {
    const ok = await settings.save(
      {
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        keyFile: keyFile.trim(),
        protectedTerms: terms
          .split(/[、,，\n]/)
          .map((value) => value.trim())
          .filter(Boolean),
        maxChars: Math.min(Math.max(numberOrDefault(maxChars, 4000), 1), 20000),
        timeoutMs: Math.min(Math.max(numberOrDefault(timeoutMs, 30000), 1000), 120000),
        continuation,
        continuationMinChars: Math.min(Math.max(numberOrDefault(minChars, 12), 4), 500),
        autoLimitPerHour: Math.min(Math.max(numberOrDefault(autoLimit, 10), 0), 60),
        nextSuggestion,
      },
      settings.revision,
    );
    setMessage(ok ? "已保存。" : (settings.saveError ?? "没有保存成功。"));
  };

  return (
    <SettingsSection
      title="辅助模型"
      info="插件只发送要优化的那段文字；密钥从本机文件读取，不写入设置。"
    >
      <SettingsCard key={formKey}>
        <SettingsInput
          label="接口地址"
          hint="例如 https://api.example.com/v1；建议 https 或本机地址，密钥会随请求发送"
          initialValue={baseUrl}
          placeholder="https://…/v1"
          onChangeText={setBaseUrl}
        />
        <SettingsInput label="模型" initialValue={model} placeholder="模型名称" onChangeText={setModel} />
        <SettingsInput
          label="密钥文件"
          hint="本人所有、权限 600 的普通文件"
          initialValue={keyFile}
          placeholder="/Users/…/assistant-key"
          onChangeText={setKeyFile}
        />
        <SettingsInput
          label="受保护术语"
          hint="用顿号或逗号分隔，改写时必须原样保留"
          initialValue={terms}
          placeholder="项目名、专有名词"
          onChangeText={setTerms}
        />
        <SettingsInput label="单次最大字符" initialValue={maxChars} onChangeText={setMaxChars} />
        <SettingsInput label="超时（毫秒）" initialValue={timeoutMs} onChangeText={setTimeoutMs} />
      </SettingsCard>
      <SettingsSection title="自动续写" info="默认关闭；开启后只在句子结束时请求一次，每小时有上限。">
        <SettingsCard>
          <SettingsSwitch
            label="输入续写"
            value={continuation}
            onValueChange={setContinuation}
          />
          <SettingsSwitch
            label="回复后下一句"
            hint="会把助手最后一条回复发给辅助模型，用来起草你的下一句话"
            value={nextSuggestion}
            onValueChange={setNextSuggestion}
          />
          <SettingsInput
            label="最少字符"
            hint="少于这个长度不请求"
            initialValue={minChars}
            onChangeText={setMinChars}
          />
          <SettingsInput
            label="每小时上限"
            hint="0 表示不自动请求"
            initialValue={autoLimit}
            onChangeText={setAutoLimit}
          />
        </SettingsCard>
      </SettingsSection>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center", padding: 16 }}>
        <Pressable
          onPress={save}
          style={{ backgroundColor: "#222", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 }}
        >
          <Text style={{ color: "#fff" }}>保存</Text>
        </Pressable>
        {message ? <Text>{message}</Text> : null}
      </View>
    </SettingsSection>
  );
}
