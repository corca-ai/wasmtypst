import type { Compiler } from "./compiler.js";
import type { CompileResult, HtmlResult, ProjectSnapshot } from "./types.js";
type Output = CompileResult | HtmlResult;
interface Job {
  snapshot: ProjectSnapshot;
  target: "paged" | "html";
  resolve: (output: Output) => void;
  reject: (error: Error) => void;
  release: () => void;
  settled: boolean;
}
const cancelled = () =>
  new DOMException("Compilation superseded or cancelled", "AbortError");

/** One running job and one latest pending snapshot. Recreates failed workers on next use. */
export class CompilerSession {
  #factory: () => Promise<Compiler>;
  #compiler: Compiler | undefined;
  #running: Job | undefined;
  #pending: Job | undefined;
  #draining = false;
  #disposed = false;
  constructor(factory: () => Promise<Compiler>) {
    this.#factory = factory;
  }
  compile(
    snapshot: ProjectSnapshot,
    options: { target: "html"; signal?: AbortSignal },
  ): Promise<HtmlResult>;
  compile(
    snapshot: ProjectSnapshot,
    options?: { target?: "paged"; signal?: AbortSignal },
  ): Promise<CompileResult>;
  compile(
    snapshot: ProjectSnapshot,
    options: { target?: "paged" | "html"; signal?: AbortSignal } = {},
  ): Promise<Output> {
    if (this.#disposed) return Promise.reject(new Error("Session is disposed"));
    if (options.signal?.aborted) return Promise.reject(cancelled());
    const entries = Object.entries(snapshot.files);
    const encoder = new TextEncoder();
    const size = entries.reduce(
      (total, [, value]) =>
        total +
        (typeof value === "string"
          ? encoder.encode(value).byteLength
          : value.byteLength),
      0,
    );
    if (entries.length > 4096 || size > 64 * 1024 * 1024)
      return Promise.reject(new Error("Snapshot exceeds admission limits"));
    const files = Object.fromEntries(
      entries.map(([path, value]) => [
        path,
        typeof value === "string" ? value : value.slice(),
      ]),
    );
    this.#reject(this.#running, cancelled());
    this.#reject(this.#pending, cancelled());
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      const job: Job = {
        snapshot: { files, entry: snapshot.entry },
        target: options.target ?? "paged",
        resolve,
        reject,
        release: () => signal?.removeEventListener("abort", abort),
        settled: false,
      };
      const abort = () => {
        this.#reject(job, cancelled());
        if (this.#running === job) {
          this.#compiler?.dispose();
          this.#compiler = undefined;
        }
        if (this.#pending === job) this.#pending = undefined;
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.#pending = job;
      void this.#drain();
    });
  }
  #reject(job: Job | undefined, error: Error): void {
    if (!job || job.settled) return;
    job.settled = true;
    job.release();
    job.reject(error);
  }
  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#pending && !this.#disposed) {
        const job = this.#pending;
        this.#pending = undefined;
        this.#running = job;
        try {
          if (this.#compiler?.isDisposed) this.#compiler = undefined;
          if (!this.#compiler) {
            const compiler = await this.#factory();
            if (this.#disposed || job.settled) {
              compiler.dispose();
              continue;
            }
            this.#compiler = compiler;
          }
          if (job.settled) continue;
          const compiler = this.#compiler;
          await compiler.snapshot(job.snapshot);
          const result = await (job.target === "html"
            ? compiler.compileHtml()
            : compiler.compile());
          if (!job.settled && !this.#disposed) {
            job.settled = true;
            job.release();
            job.resolve(result);
          }
        } catch (error) {
          this.#compiler?.dispose();
          this.#compiler = undefined;
          this.#reject(
            job,
            error instanceof Error ? error : new Error(String(error)),
          );
        } finally {
          if (this.#running === job) this.#running = undefined;
        }
      }
    } finally {
      this.#draining = false;
    }
  }
  pdf(revision: number): Promise<Uint8Array<ArrayBuffer>> {
    if (this.#running || this.#pending || !this.#compiler)
      return Promise.reject(new Error("No settled compilation"));
    return this.#compiler.pdf(revision);
  }
  svg(revision: number, page: number): Promise<string> {
    if (this.#running || this.#pending || !this.#compiler)
      return Promise.reject(new Error("No settled compilation"));
    return this.#compiler.svg(revision, page);
  }
  outputToSource(
    revision: number,
    point: import("./types.js").PagePoint,
  ): Promise<import("./types.js").Jump> {
    if (this.#running || this.#pending || !this.#compiler)
      return Promise.reject(new Error("No settled compilation"));
    return this.#compiler.outputToSource(revision, point);
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#reject(this.#running, cancelled());
    this.#reject(this.#pending, cancelled());
    this.#pending = undefined;
    this.#compiler?.dispose();
    this.#compiler = undefined;
  }
}
