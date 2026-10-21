import init, { parse_markup } from "../dist/syntax/wasmtypst_syntax.js";
import type { WasmSource } from "./types.js";

/** The official syntax tree. Unknown kinds must remain source in an editor. */
export interface SyntaxNode {
  kind: string;
  from: number;
  to: number;
  value?: string;
  block?: boolean;
  children: SyntaxNode[];
}
export interface SyntaxParser {
  parse(source: string): SyntaxNode;
}
let initialization: Promise<SyntaxParser> | undefined;
let initializedSource: WasmSource | undefined;

/** A syntax-only runtime: no fonts, layout, compilation, World or document state. */
export function createSyntaxParser(wasm?: WasmSource): Promise<SyntaxParser> {
  if (initialization && wasm !== undefined && wasm !== initializedSource)
    return Promise.reject(
      new Error("Syntax runtime already initialized with another source"),
    );
  if (!initialization) {
    initializedSource = wasm;
    initialization = (async () => {
      await init({
        module_or_path:
          wasm ?? new URL("./syntax/wasmtypst_syntax_bg.wasm", import.meta.url),
      });
      return {
        parse(source: string): SyntaxNode {
          return parse_markup(source);
        },
      };
    })();
    initialization.catch(() => {
      initialization = undefined;
      initializedSource = undefined;
    });
  }
  return initialization;
}
