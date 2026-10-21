export type WasmSource =
  | string
  | URL
  | Uint8Array<ArrayBuffer>
  | ArrayBuffer
  | WebAssembly.Module;
export interface SourceLocation {
  path: string;
  from: number;
  to: number;
}
export interface PagePoint {
  page: number;
  x: number;
  y: number;
}
export interface PageInfo {
  width: number;
  height: number;
}
export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  hints: string[];
  trace: string[];
  location: SourceLocation | null;
}
export interface CompileResult {
  revision: number;
  success: boolean;
  pages: PageInfo[];
  diagnostics: Diagnostic[];
  dependencies: string[];
  missingFiles: string[];
  fingerprint: string;
}
export interface HtmlOptions {
  /** Return native MathML fragments with exact source locations for visual editors. */
  math?: boolean;
}
export interface HtmlResult extends Omit<CompileResult, "pages"> {
  html: string | null;
  /** Untrusted markup. Isolate or sanitize before showing it in a trusted DOM. */
  math: { location: SourceLocation; html: string }[];
}
export interface ProjectSnapshot {
  files: Record<string, string | Uint8Array<ArrayBuffer>>;
  entry: string;
}
export interface CompletionItem {
  kind: string;
  label: string;
  apply: string | null;
  detail: string | null;
}
export interface Completions {
  from: number;
  to: number;
  items: CompletionItem[];
}
export interface Hover {
  kind: "text" | "code";
  text: string;
}
export interface Edit extends SourceLocation {
  text: string;
}
export interface EditPlan {
  revision: number;
  edits: Edit[];
}
export interface FormatEdit extends Edit {
  revision: number;
}
export interface SemanticToken {
  from: number;
  to: number;
  kind:
    | "comment"
    | "string"
    | "number"
    | "variable"
    | "label"
    | "heading"
    | "keyword";
}
export interface Symbol extends SourceLocation {
  kind: string;
  name: string;
}
export type Jump = SourceLocation | PagePoint | { url: string } | null;
export interface Configuration {
  inputs?: Record<string, string>;
  date?: [number, number, number];
}
export interface CompilerOptions {
  wasm?: WasmSource;
  files?: Record<string, string | Uint8Array<ArrayBuffer>>;
  entry?: string;
  configuration?: Configuration;
  timeoutMs?: number;
  resolveFile?: (
    path: string,
    signal: AbortSignal,
  ) => Promise<string | Uint8Array<ArrayBuffer> | null>;
}
export type Query =
  | { op: "entry" | "remove"; path: string }
  | { op: "compile" }
  | ({ op: "compileHtml" } & HtmlOptions)
  | ({ op: "configure" } & Configuration)
  | {
      op: "completion" | "hover" | "definition" | "references";
      path: string;
      offset: number;
    }
  | { op: "rename"; path: string; offset: number; newName: string }
  | { op: "format" | "semanticTokens" | "symbols" | "folding"; path: string }
  | { op: "sourceToOutput"; path: string; offset: number; revision: number }
  | ({ op: "outputToSource"; revision: number } & PagePoint);
export type Command =
  | { kind: "init"; wasm?: Exclude<WasmSource, URL> }
  | { kind: "put"; path: string; bytes: Uint8Array<ArrayBuffer> }
  | {
      kind: "snapshot";
      files: [string, Uint8Array<ArrayBuffer>][];
      entry: string;
    }
  | { kind: "font"; bytes: Uint8Array<ArrayBuffer> }
  | { kind: "query"; request: Query }
  | { kind: "pdf"; revision: number }
  | { kind: "svg"; revision: number; page: number }
  | { kind: "stats" };
export interface Request {
  id: number;
  command: Command;
}
export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string; fatal?: boolean };
export interface Transport {
  post(request: Request): void;
  listen(
    onMessage: (data: unknown) => void,
    onError: (error: Error) => void,
  ): () => void;
  terminate(): void;
}
