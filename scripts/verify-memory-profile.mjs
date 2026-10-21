import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyMemoryLimit } from "./wasm-memory-limit.mjs";
import initialize, { TypstEngine } from "../dist/wasm/wasmtypst.js";
const mib = Number(process.argv[2]);
assert.ok([256, 512, 1024].includes(mib));
const module = await initialize({
  module_or_path: await readFile(
    `tests/fixtures/.memory-profiles/${mib}/wasmtypst_bg.wasm`,
  ),
});
const engine = new TypstEngine();
assert.equal(engine.memory_limit(), mib * 1024 * 1024);
engine.free();
verifyMemoryLimit(module.memory, mib * 1024 * 1024);
console.log(`${mib} MiB actual memory ceiling verified`);
