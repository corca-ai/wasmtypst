import { Compiler } from "./compiler.js";
import type { CompilerOptions } from "./types.js";
export { Compiler } from "./compiler.js";
export type * from "./types.js";

export async function createCompiler(
  options: CompilerOptions = {},
): Promise<Compiler> {
  const worker = new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
  });
  const compiler = new Compiler(
    {
      post(request) {
        worker.postMessage(request);
      },
      listen(onMessage, onError) {
        const message = (event: MessageEvent) => onMessage(event.data);
        const error = (event: ErrorEvent) => onError(new Error(event.message));
        const messageError = () =>
          onError(new Error("Worker message could not be decoded"));
        worker.addEventListener("message", message);
        worker.addEventListener("error", error);
        worker.addEventListener("messageerror", messageError);
        return () => {
          worker.removeEventListener("message", message);
          worker.removeEventListener("error", error);
          worker.removeEventListener("messageerror", messageError);
        };
      },
      terminate() {
        worker.terminate();
      },
    },
    options,
  );
  await compiler.initialize(options);
  return compiler;
}
