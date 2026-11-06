import { Platform } from "react-native";
import { editorDocument } from "../shared/editor-document";
import type { WorkspaceRequest, WorkspaceResponse } from "../shared/contracts";

// Browser APIs stay in this adapter; React Native clients render a fallback.
interface FrameWindow { postMessage(message: unknown, target: string): void; }
interface Frame {
  title: string; srcdoc: string; style: { cssText: string }; contentWindow: FrameWindow | null;
  setAttribute(name: string, value: string): void; remove(): void;
}
interface Host { appendChild(frame: Frame): unknown; }
interface Message { source: unknown; data: Record<string, unknown> | null; }
declare const document: { createElement(tag: "iframe"): Frame };
declare const window: {
  addEventListener(name: "message", callback: (message: Message) => void): void;
  removeEventListener(name: "message", callback: (message: Message) => void): void;
};
type Options = {
  path: string | null; colors: Record<string, string>;
  request(input: WorkspaceRequest): Promise<WorkspaceResponse>;
  onPath(path: string | null): void; onModified(modified: boolean): void; onError(message: string): void;
};
export type EditorFrame = { update(colors: Record<string, string>): void; dispose(): void };
export function mountEditor(host: unknown, options: Options): EditorFrame | null {
  if (Platform.OS !== "web") return null;
  const namespace = "paseo-slide-studio";
  const nonce = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join("");
  const frame = document.createElement("iframe");
  frame.title = "Slide Studio 内置幻灯片编辑器";
  frame.setAttribute("data-testid", "slide-studio-editor");
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-downloads allow-modals");
  frame.setAttribute("allow", "fullscreen"); frame.setAttribute("referrerpolicy", "no-referrer");
  frame.style.cssText = "width:100%;height:100%;flex:1;border:0;display:block;min-width:0;min-height:0;background:transparent";
  let disposed = false, ready = false, colors = options.colors;
  const send = (message: Record<string, unknown>) => { if (!disposed) frame.contentWindow?.postMessage({ namespace, nonce, ...message }, "*"); };
  const timeout = setTimeout(() => { if (!ready) options.onError("内置编辑器加载超时，请重新打开面板。"); }, 20000);
  const receive = (event: Message) => {
    const message = event.data;
    if (disposed || event.source !== frame.contentWindow || message?.namespace !== namespace) return;
    if (message.type === "ready") { ready = true; clearTimeout(timeout); send({ type: "init", path: options.path, colors }); return; }
    if (message.nonce !== nonce) return;
    if (message.type === "path" && (typeof message.path === "string" || message.path === null)) options.onPath(message.path);
    if (message.type === "modified" && typeof message.modified === "boolean") options.onModified(message.modified);
    if (message.type === "error" && typeof message.message === "string") options.onError(message.message);
    if (message.type !== "request" || !Number.isSafeInteger(message.id)) return;
    const id = message.id;
    void options.request(message.request as WorkspaceRequest).then(
      result => send({ type: "response", id, result }),
      error => send({ type: "response", id, error: error instanceof Error ? error.message : String(error) }),
    );
  };
  window.addEventListener("message", receive);
  frame.srcdoc = editorDocument; (host as Host).appendChild(frame);
  return {
    update(next) { if (Platform.OS !== "web") return; colors = next; if (ready) send({ type: "theme", colors }); },
    dispose() { if (Platform.OS !== "web" || disposed) return; disposed = true; clearTimeout(timeout); window.removeEventListener("message", receive); frame.remove(); },
  };
}
