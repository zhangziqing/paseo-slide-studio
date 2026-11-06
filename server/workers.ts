import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { WorkspaceRequest, WorkspaceResponse } from "../shared/contracts.ts";
import { workspaceResponse } from "../shared/contracts.ts";
import { editorAssets } from "./editor-assets.ts";

export class Worker {
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: WorkspaceResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private child: ChildProcessWithoutNullStreams;
  private ready: Promise<void>;
  private ended: Promise<void>;
  private exited = false;
  readonly python: string;

  constructor(assets: string, root: string, python: string) {
    this.python = python;
    this.child = spawn(python, ["-u", join(assets, "runner_rpc.py"), root], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child.stdin.on("error", () => {});
    let stderr = "";
    this.child.stderr.on("data", (data: Buffer) => { stderr = (stderr + data.toString()).slice(-4000); });
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const timeout = setTimeout(() => {
      rejectReady(new Error("文件处理进程启动超时。"));
      this.child.kill("SIGKILL");
    }, 8000);
    this.ready = new Promise((resolve, reject) => { resolveReady = () => { clearTimeout(timeout); resolve(); }; rejectReady = error => { clearTimeout(timeout); reject(error); }; });
    void this.ready.catch(() => {});
    this.ended = new Promise(resolve => {
      const fail = (error: Error) => {
        this.exited = true;
        rejectReady(error);
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
        this.pending.clear();
        resolve();
      };
      this.child.once("error", error => fail(new Error("无法启动 Python：" + error.message)));
      this.child.once("exit", () => fail(new Error(stderr || "文件处理进程已退出。")));
    });
    createInterface({ input: this.child.stdout }).on("line", line => {
      try {
        const value = JSON.parse(line);
        if (value.ready === true) { resolveReady(); return; }
        const request = this.pending.get(value.id);
        if (!request) return;
        this.pending.delete(value.id); clearTimeout(request.timer);
        try { request.resolve(workspaceResponse.parse(value)); }
        catch { request.reject(new Error("文件处理进程返回了无效结果。")); }
      } catch (error) {
        rejectReady(error instanceof Error ? error : new Error(String(error)));
        this.child.kill("SIGKILL");
      }
    });
  }

  get alive() { return !this.exited; }

  async request(request: WorkspaceRequest) {
    await this.ready;
    if (this.exited) throw new Error("文件处理进程已退出，请重新打开文件。");
    const id = ++this.sequence;
    return new Promise<WorkspaceResponse>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("文件操作超时，请重新读取文件后重试。")); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, request }) + "\n", error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }

  async close() {
    if (this.exited) return;
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 2000);
    await this.ended;
    clearTimeout(timer);
  }
}

export class WorkspaceWorkers {
  private workers = new Map<string, Promise<Worker>>();
  private assets: Promise<string> | undefined;
  private closed = false;

  private prepareAssets() {
    return this.assets ??= (async () => {
      const directory = await mkdtemp(join(tmpdir(), "paseo-slide-files-"));
      try {
        for (const file of ["server.py", "runner_rpc.py"]) await writeFile(join(directory, file), editorAssets[file]);
        return directory;
      } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
    })();
  }

  async request(root: string, python: string, request: WorkspaceRequest) {
    if (this.closed) throw new Error("编辑器插件已停止。");
    const directory = await realpath(root);
    let pending = this.workers.get(directory);
    if (pending) {
      const previous = await pending;
      if (!previous.alive || previous.python !== python) { await previous.close(); this.workers.delete(directory); pending = undefined; }
    }
    if (!pending) {
      pending = this.prepareAssets().then(async assets => {
        if (this.closed) throw new Error("编辑器插件已停止。");
        const worker = new Worker(assets, directory, python);
        try { await worker.request({ method: "info" }); return worker; }
        catch (error) { await worker.close(); throw error; }
      });
      this.workers.set(directory, pending);
      void pending.catch(() => { if (this.workers.get(directory) === pending) this.workers.delete(directory); });
    }
    const worker = await pending;
    try { return await worker.request(request); }
    catch (error) {
      if (!worker.alive && this.workers.get(directory) === pending) this.workers.delete(directory);
      throw error;
    }
  }

  async close() {
    this.closed = true;
    await Promise.allSettled([...this.workers.values()].map(async worker => (await worker).close()));
    this.workers.clear();
    if (this.assets) { try { await rm(await this.assets, { recursive: true, force: true }); } catch {} }
  }
}
