import type {
  Command,
  CompilerOptions,
  CompileResult,
  Completions,
  Configuration,
  EditPlan,
  FormatEdit,
  Hover,
  Jump,
  PagePoint,
  Query,
  SemanticToken,
  SourceLocation,
  Symbol,
  Transport,
} from "./types.js";

export class Compiler {
  #transport: Transport;
  #release: () => void;
  #pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  #nextId = 1;
  #disposed = false;
  #timeout: number;
  #resolver: CompilerOptions["resolveFile"];
  constructor(transport: Transport, options: CompilerOptions = {}) {
    this.#transport = transport;
    this.#timeout = options.timeoutMs ?? 60_000;
    if (!Number.isFinite(this.#timeout) || this.#timeout <= 0) {
      transport.terminate();
      throw new Error("timeoutMs must be positive and finite");
    }
    this.#resolver = options.resolveFile;
    this.#release = transport.listen(
      (data) => {
        if (
          typeof data !== "object" ||
          data === null ||
          !("id" in data) ||
          typeof data.id !== "number"
        )
          return;
        const pending = this.#pending.get(data.id);
        if (!pending) return;
        this.#pending.delete(data.id);
        clearTimeout(pending.timer);
        if ("ok" in data && data.ok === true && "result" in data)
          pending.resolve(data.result);
        else {
          const error = new Error(
            "error" in data ? String(data.error) : "Malformed worker response",
          );
          pending.reject(error);
          if ("fatal" in data && data.fatal === true) this.#fail(error);
        }
      },
      (error) => this.#fail(error),
    );
  }
  #fail(error: Error): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#release();
    this.#transport.terminate();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
  #invoke<T>(command: Command): Promise<T> {
    if (this.#disposed)
      return Promise.reject(new Error("Compiler is disposed"));
    const id = this.#nextId++;
    // The only cast is the typed engine/worker protocol boundary. All public
    // methods below specify the Rust operation's exact result contract.
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => this.#fail(new Error("Worker timed out; compiler terminated")),
        this.#timeout,
      );
      this.#pending.set(id, { resolve, reject, timer });
      try {
        this.#transport.post({ id, command });
      } catch (error) {
        this.#fail(error instanceof Error ? error : new Error(String(error)));
      }
    }) as Promise<T>;
  }
  async initialize(options: CompilerOptions): Promise<void> {
    try {
      const wasm =
        options.wasm instanceof URL ? options.wasm.href : options.wasm;
      await this.#invoke({
        kind: "init",
        ...(wasm === undefined ? {} : { wasm }),
      });
      for (const [path, bytes] of Object.entries(options.files ?? {}))
        await this.putFile(path, bytes);
      if (options.entry) await this.setEntry(options.entry);
      if (options.configuration) await this.configure(options.configuration);
    } catch (error) {
      this.dispose();
      throw error;
    }
  }
  #query<T>(request: Query): Promise<T> {
    return this.#invoke({ kind: "query", request });
  }
  putFile(
    path: string,
    content: string | Uint8Array<ArrayBuffer>,
  ): Promise<number> {
    const bytes =
      typeof content === "string" ? new TextEncoder().encode(content) : content;
    if (bytes.byteLength > 16 * 1024 * 1024)
      return Promise.reject(new Error("File exceeds 16 MiB"));
    return this.#invoke({ kind: "put", path, bytes });
  }
  removeFile(path: string): Promise<number> {
    return this.#query({ op: "remove", path });
  }
  setEntry(path: string): Promise<number> {
    return this.#query({ op: "entry", path });
  }
  configure(configuration: Configuration): Promise<number> {
    return this.#query({ op: "configure", ...configuration });
  }
  addFont(bytes: Uint8Array<ArrayBuffer>): Promise<number> {
    if (bytes.byteLength > 16 * 1024 * 1024)
      return Promise.reject(new Error("Font exceeds 16 MiB"));
    return this.#invoke({ kind: "font", bytes });
  }
  async compile(): Promise<CompileResult> {
    const attempted = new Set<string>();
    for (let round = 0; round < 64; round++) {
      const result = await this.#query<CompileResult>({ op: "compile" });
      if (result.success || !this.#resolver) return result;
      let added = false;
      for (const path of result.missingFiles) {
        if (attempted.has(path)) continue;
        attempted.add(path);
        const bytes = await this.#resolver(path);
        if (this.#disposed) throw new Error("Compiler is disposed");
        if (bytes !== null) {
          await this.putFile(path, bytes);
          added = true;
        }
      }
      if (!added) return result;
    }
    throw new Error("Dependency resolution exceeded 64 rounds");
  }
  pdf(revision: number): Promise<Uint8Array<ArrayBuffer>> {
    return this.#invoke({ kind: "pdf", revision });
  }
  svg(revision: number, page: number): Promise<string> {
    return this.#invoke({ kind: "svg", revision, page });
  }
  completion(path: string, offset: number): Promise<Completions> {
    return this.#query({ op: "completion", path, offset });
  }
  hover(path: string, offset: number): Promise<Hover | null> {
    return this.#query({ op: "hover", path, offset });
  }
  definition(path: string, offset: number): Promise<SourceLocation | null> {
    return this.#query({ op: "definition", path, offset });
  }
  references(path: string, offset: number): Promise<SourceLocation[]> {
    return this.#query({ op: "references", path, offset });
  }
  rename(path: string, offset: number, newName: string): Promise<EditPlan> {
    return this.#query({ op: "rename", path, offset, newName });
  }
  format(path: string): Promise<FormatEdit> {
    return this.#query({ op: "format", path });
  }
  semanticTokens(path: string): Promise<SemanticToken[]> {
    return this.#query({ op: "semanticTokens", path });
  }
  symbols(path: string): Promise<Symbol[]> {
    return this.#query({ op: "symbols", path });
  }
  folding(path: string): Promise<Symbol[]> {
    return this.#query({ op: "folding", path });
  }
  sourceToOutput(
    revision: number,
    path: string,
    offset: number,
  ): Promise<PagePoint[]> {
    return this.#query({ op: "sourceToOutput", revision, path, offset });
  }
  outputToSource(revision: number, point: PagePoint): Promise<Jump> {
    return this.#query({ op: "outputToSource", revision, ...point });
  }
  stats(): Promise<{
    revision: number;
    wasmLinearMemoryBytes: number;
    typstVersion: string;
  }> {
    return this.#invoke({ kind: "stats" });
  }
  dispose(): void {
    this.#fail(new Error("Compiler is disposed"));
  }
}
