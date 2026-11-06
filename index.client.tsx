import type { PluginClientContext } from "@getpaseo/plugin/client";
import { StudioFilePanel, StudioPanel } from "./client/studio";
import { StudioSettings } from "./client/settings";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({ id: "studio", title: "幻灯片编辑器", icon: "Presentation", Component: StudioPanel });
  client.addFilePanel({
    id: "slides", title: "幻灯片编辑器", icon: "Presentation",
    files: { extensions: ["html", "htm"] }, Component: StudioFilePanel,
  });
  client.addSettingsScreen({ id: "connection", title: "Slide Studio", icon: "Presentation", Component: StudioSettings });
  client.addCommandCenterItem({
    id: "open-studio", title: "打开幻灯片编辑器", icon: "Presentation", context: "workspace",
    keywords: ["slides", "ppt", "studio"], onSelect: ({ openPanel }) => openPanel("studio"),
  });
  client.addSlashCommand({
    name: "slides", description: "打开幻灯片编辑器", argumentHint: "", context: "workspace",
    onSubmit: ({ openPanel }) => openPanel("studio"),
  });
  return () => {};
}
