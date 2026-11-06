import type { PluginServerContext } from "@getpaseo/plugin/server";
import { realpath } from "node:fs/promises";
import { connectionSettings, editWorkspace } from "./shared/contracts.ts";
import { WorkspaceWorkers } from "./server/workers.ts";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(connectionSettings);
  const workers = new WorkspaceWorkers();
  server.handle(editWorkspace, async ({ workspaceId, request }, { paseo }) => {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    if (!workspace?.workspaceDirectory) throw new Error("工作区不存在或尚未准备完成。");
    const configuration = await settings.read();
    if (configuration.status !== "ready") throw new Error("请检查 Slide Studio 的 Python 设置。");
    return workers.request(await realpath(workspace.workspaceDirectory), configuration.values.python, request);
  });
  return () => workers.close();
}
