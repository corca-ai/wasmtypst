import { serve } from "./worker-host.js";
serve({
  listen(handler) {
    globalThis.addEventListener("message", (event: MessageEvent) =>
      handler(event.data),
    );
  },
  post(response, transfer) {
    globalThis.postMessage(response, { transfer });
  },
});
