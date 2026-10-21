import { Worker } from "node:worker_threads";
import { Compiler } from "./compiler.js";
import type { CompilerOptions } from "./types.js";
export { Compiler } from "./compiler.js";
export type * from "./types.js";

function workerArguments(): string[] {
  const args: string[] = [];
  for (let index = 0; index < process.execArgv.length; index++) {
    const arg = process.execArgv[index];
    if (!arg) continue;
    if (["--input-type", "--eval", "-e", "--print", "-p"].includes(arg)) {
      index++;
      continue;
    }
    if (
      ["--input-type=", "--eval=", "--print="].some((prefix) =>
        arg.startsWith(prefix),
      )
    )
      continue;
    args.push(arg);
  }
  return args;
}

export async function createCompiler(
  options: CompilerOptions = {},
): Promise<Compiler> {
  const worker = new Worker(new URL("./node-worker.js", import.meta.url), {
    execArgv: workerArguments(),
  });
  const compiler = new Compiler(
    {
      post(request) {
        worker.postMessage(request);
      },
      listen(onMessage, onError) {
        const exit = (code: number) =>
          onError(new Error(`Worker exited (${code})`));
        worker.on("message", onMessage);
        worker.on("error", onError);
        worker.on("exit", exit);
        worker.on("messageerror", onError);
        return () => {
          worker.off("message", onMessage);
          worker.off("error", onError);
          worker.off("exit", exit);
          worker.off("messageerror", onError);
        };
      },
      terminate() {
        void worker.terminate();
      },
    },
    options,
  );
  await compiler.initialize(options);
  return compiler;
}

export { CompilerSession } from "./session.js";
