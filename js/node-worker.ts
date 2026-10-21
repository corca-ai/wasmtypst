import { parentPort } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { serve } from "./worker-host.js";
if (!parentPort) throw new Error("Node worker needs a parent port");
const port = parentPort;
serve({
  listen(handler) {
    port.on("message", async (request) => {
      if (
        request.command?.kind === "init" &&
        request.command.wasm === undefined
      ) {
        try {
          request.command.wasm = new Uint8Array(
            await readFile(
              new URL("./wasm/wasmtypst_bg.wasm", import.meta.url),
            ),
          );
        } catch (error) {
          port.postMessage({ id: request.id, ok: false, error: String(error) });
          return;
        }
      }
      handler(request);
    });
  },
  post(response, transfer) {
    port.postMessage(response, transfer);
  },
});
