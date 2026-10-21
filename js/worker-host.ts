import { instantiate, type Core } from "./core.js";
import type { Request, Response } from "./types.js";
export interface Port {
  listen(handler: (request: Request) => void): void;
  post(response: Response, transfer: ArrayBuffer[]): void;
}
export function serve(port: Port): void {
  let core: Core | undefined;
  let queue = Promise.resolve();
  port.listen((request) => {
    queue = queue.then(async () => {
      try {
        if (!Number.isSafeInteger(request?.id) || !request.command)
          throw new Error("Invalid worker request");
        let result: unknown;
        if (request.command.kind === "init") {
          if (core) throw new Error("Worker is already initialized");
          core = await instantiate(request.command.wasm);
          result = true;
        } else {
          if (!core) throw new Error("Worker is not initialized");
          result = core.execute(request.command);
        }
        const transfer =
          result instanceof Uint8Array && result.buffer instanceof ArrayBuffer
            ? [result.buffer]
            : [];
        port.post({ id: request.id, ok: true, result }, transfer);
      } catch (error) {
        const fatal = error instanceof WebAssembly.RuntimeError;
        if (fatal) core = undefined;
        port.post(
          {
            id: request.id,
            ok: false,
            error: String(error instanceof Error ? error.message : error),
            fatal,
          },
          [],
        );
      }
    });
  });
}
