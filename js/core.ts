import init, { TypstEngine } from "../dist/wasm/wasmtypst.js";
import type { Command, WasmSource } from "./types.js";
export type { WasmSource } from "./types.js";
export interface Core {
  execute(command: Exclude<Command, { kind: "init" }>): unknown;
  dispose(): void;
}
let initialization: Promise<void> | undefined;
let initializedSource: WasmSource | undefined;
let memory: WebAssembly.Memory | undefined;

/** A realm shares one compiled WASM module. Each Core owns its own World. */
export async function instantiate(wasm?: WasmSource): Promise<Core> {
  if (!initialization) {
    initializedSource = wasm;
    initialization = (async () => {
      let source = wasm;
      if (source === undefined) {
        const response = await fetch(
          new URL("./wasm/wasmtypst_bg.wasm.gz", import.meta.url),
        );
        if (!response.ok || !response.body)
          throw new Error(`WASM fetch failed (${response.status})`);
        // Hosts such as Vite transparently decode .wasm.gz via Content-Encoding.
        // Inspect the actual stream bytes instead of assuming the transport policy.
        const reader = response.body.getReader();
        const prefix: Uint8Array<ArrayBuffer>[] = [];
        const header = new Uint8Array(4);
        let length = 0;
        while (length < 4) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error("Truncated WASM response");
          prefix.push(chunk.value);
          const count = Math.min(4 - length, chunk.value.length);
          header.set(chunk.value.subarray(0, count), length);
          length += count;
        }
        const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
          start(controller) {
            for (const chunk of prefix) controller.enqueue(chunk);
          },
          async pull(controller) {
            const chunk = await reader.read();
            if (chunk.done) controller.close();
            else controller.enqueue(chunk.value);
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        });
        const payload =
          header[0] === 0 &&
          header[1] === 97 &&
          header[2] === 115 &&
          header[3] === 109
            ? stream
            : stream.pipeThrough(new DecompressionStream("gzip"));
        source = new Uint8Array(await new Response(payload).arrayBuffer());
      }
      const output = await init({ module_or_path: source });
      memory = output.memory;
    })();
    initialization.catch(() => {
      initialization = undefined;
      initializedSource = undefined;
    });
  } else if (wasm !== undefined && initializedSource !== wasm) {
    throw new Error(
      "This realm already initialized a different WASM source; use a separate worker",
    );
  }
  await initialization;
  return new EngineCore(new TypstEngine());
}

class EngineCore implements Core {
  #engine: TypstEngine | undefined;
  constructor(engine: TypstEngine) {
    this.#engine = engine;
  }
  execute(command: Exclude<Command, { kind: "init" }>): unknown {
    const engine = this.#engine;
    if (!engine) throw new Error("Engine is disposed");
    switch (command.kind) {
      case "put":
        return engine.put(command.path, command.bytes);
      case "snapshot":
        return engine.snapshot(command.files, command.entry);
      case "font":
        return engine.add_font(command.bytes);
      case "query":
        return engine.request(command.request);
      case "pdf":
        return engine.pdf(command.revision);
      case "svg":
        return engine.svg(command.revision, command.page);
      case "stats":
        return {
          revision: engine.revision(),
          wasmLinearMemoryBytes: memory?.buffer.byteLength ?? 0,
          wasmLinearMemoryLimitBytes: 256 * 1024 * 1024,
          typstVersion: "0.15.1",
        };
    }
  }
  dispose(): void {
    this.#engine?.free();
    this.#engine = undefined;
  }
}
