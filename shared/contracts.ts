import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const connectionSchema = z.object({
  python: z.string().trim().min(1).default("python3"),
});
export type ConnectionSettings = z.infer<typeof connectionSchema>;
export const connectionSettings = defineSettings({ id: "connection", scope: "host", version: 1, schema: connectionSchema });
export const workspaceRequest = z.discriminatedUnion("method", [
  z.object({ method: z.literal("info") }),
  z.object({ method: z.literal("list"), path: z.string() }),
  z.object({ method: z.literal("read"), path: z.string() }),
  z.object({ method: z.literal("asset"), path: z.string() }),
  z.object({ method: z.literal("save"), path: z.string(), revision: z.string(), content: z.string() }),
]);
export type WorkspaceRequest = z.infer<typeof workspaceRequest>;
export const workspaceResponse = z.object({ status: z.number().int(), data: z.json() });
export type WorkspaceResponse = z.infer<typeof workspaceResponse>;
export const editWorkspace = defineRpc({
  name: "workspace.request",
  input: z.object({ workspaceId: z.string().min(1), request: workspaceRequest }),
  output: workspaceResponse,
});
