import type { PluginFilePanelProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useTabState } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { z } from "zod";
import { editWorkspace, workspaceRequest } from "../shared/contracts";
import { mountEditor, type EditorFrame } from "./web";

const stateSchema = z.object({ path: z.string().nullable() });
type Props = Pick<PluginWorkspacePanelProps, "theme" | "workspaceId" | "tab"> & { filePath?: string };
function Studio({ theme, workspaceId, tab, filePath }: Props) {
  const request = useRpc(editWorkspace);
  const [state, setState] = useTabState(tab, stateSchema, { path: filePath ?? null });
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const host = useRef<View | null>(null);
  const frame = useRef<EditorFrame | null>(null);
  const current = useRef({ request, setState, tab, state });
  current.current = { request, setState, tab, state };
  const colors = theme.colors;
  useEffect(() => {
    if (Platform.OS !== "web" || !host.current) return;
    setError("");
    const mounted = mountEditor(host.current, {
      path: filePath ?? current.current.state.path, colors,
      request: async input => current.current.request({ workspaceId, request: workspaceRequest.parse(input) }),
      onPath: path => current.current.setState({ path }),
      onModified: modified => current.current.tab.setModified(modified),
      onError: setError,
    });
    frame.current = mounted;
    return () => { mounted?.dispose(); frame.current = null; };
  }, [workspaceId, filePath, attempt]);
  useEffect(() => { frame.current?.update(colors); }, [colors]);
  if (Platform.OS !== "web") return (
    <View testID="slide-studio" style={{ flex: 1, padding: 20, gap: 12, backgroundColor: colors.surface0 }}>
      <Text style={{ color: colors.foreground, fontSize: 18 }}>幻灯片编辑器</Text>
      <Text style={{ color: colors.foregroundMuted }}>内置编辑画布目前支持 Paseo 桌面版和网页版。请在电脑上打开此工作区使用。</Text>
    </View>
  );
  return (
    <View testID="slide-studio" style={{ flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.surface0 }}>
      {error !== "" && <View style={{ padding: 12, gap: 8, backgroundColor: colors.surface1 }}>
        <Text accessibilityRole="alert" style={{ color: colors.statusDanger }}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)}>
          <Text style={{ color: colors.accent }}>重新连接编辑器</Text>
        </Pressable>
      </View>}
      <View ref={host} style={{ flex: 1, minWidth: 0, minHeight: 0 }} />
    </View>
  );
}
export function StudioPanel(props: PluginWorkspacePanelProps) { return <Studio key={props.workspaceId} {...props} />; }
export function StudioFilePanel(props: PluginFilePanelProps) { return <Studio key={props.workspaceId + props.file.path} {...props} filePath={props.file.path} />; }
