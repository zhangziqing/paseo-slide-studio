import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { useState } from "react";
import { Pressable, Text, TextInput, View, ScrollView } from "react-native";
import { connectionSchema, connectionSettings, type ConnectionSettings } from "../shared/contracts";

type FormProps = Pick<PluginSurfaceProps, "theme" | "layout">;
export function ConnectionForm({ theme, layout }: FormProps) {
  const settings = useSettings(connectionSettings);
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState(false);
  if (settings.status === "loading") return <Text style={{ color: theme.colors.foregroundMuted }}>正在读取编辑器设置…</Text>;
  if (settings.status !== "ready") return <View style={{ gap: 12 }}>
    <Text style={{ color: theme.colors.statusDanger }}>{settings.error}</Text>
    <Pressable accessibilityRole="button" onPress={() => void settings.reset()}><Text style={{ color: theme.colors.accent }}>恢复默认设置</Text></Pressable>
  </View>;
  return <View style={{ gap: 12 }}>
    <SettingsFields key={version} {...{ theme, layout }} values={settings.values} revision={settings.revision}
      saving={settings.saving} error={settings.saveError} save={async (values, revision) => {
        const success = await settings.save(values, revision); setSaved(success);
        if (success) setVersion(value => value + 1); return success;
      }} />
    {saved && <Text style={{ color: theme.colors.statusSuccess }}>编辑器设置已保存。</Text>}
  </View>;
}
function SettingsFields({ theme, values, revision, saving, error, save }: FormProps & {
  values: ConnectionSettings; revision: string; saving: boolean; error: string | null;
  save: (values: ConnectionSettings, revision: string) => Promise<boolean>;
}) {
  const [python, setPython] = useState(values.python);
  const [draftRevision] = useState(revision);
  const [localError, setLocalError] = useState("");
  const colors = theme.colors;
  async function commit() {
    const result = connectionSchema.safeParse({ python });
    if (!result.success) { setLocalError("请填写 Python 可执行文件名或完整路径。"); return; }
    setLocalError(""); await save(result.data, draftRevision);
  }
  return <View style={{ gap: 12 }}>
    <Text style={{ color: colors.foregroundMuted }}>编辑器直接显示在工作区面板中，文件通过当前 Paseo 连接读写。此设置保存在当前主机，下一次文件操作时生效。</Text>
    <Text style={{ color: colors.foreground }}>主机上的 Python 可执行文件</Text>
    <TextInput testID="studio-python" accessibilityLabel="Python 可执行文件" value={python} onChangeText={setPython}
      autoCapitalize="none" autoCorrect={false}
      style={{ padding: 10, borderRadius: 6, borderWidth: 1, borderColor: colors.border, color: colors.foreground, backgroundColor: colors.surface1 }} />
    {(localError || error) && <Text accessibilityRole="alert" style={{ color: colors.statusDanger }}>{localError || error}</Text>}
    <Pressable testID="studio-save-settings" accessibilityRole="button" disabled={saving} onPress={() => void commit()}
      style={{ alignSelf: "flex-start", backgroundColor: colors.accent, padding: 12, borderRadius: 6, opacity: saving ? 0.6 : 1 }}>
      <Text style={{ color: colors.accentForeground }}>{saving ? "正在保存…" : "保存设置"}</Text>
    </Pressable>
  </View>;
}
export function StudioSettings({ theme, layout }: PluginSurfaceProps) {
  return <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding: layout.compact ? 16 : 24 }}>
    <ConnectionForm theme={theme} layout={layout} />
  </ScrollView>;
}
