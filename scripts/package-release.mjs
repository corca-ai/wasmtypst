import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
const receipt = JSON.parse(await readFile("dist/build.json", "utf8"));
if (!receipt.optimized) throw new Error("Release requires optimized WASM");
const wasm = await readFile("dist/wasm/wasmtypst_bg.wasm");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (hash(wasm) !== receipt.wasm.sha256)
  throw new Error("WASM provenance mismatch");
const syntax = await readFile("dist/syntax/wasmtypst_syntax_bg.wasm");
if (hash(syntax) !== receipt.syntax.sha256)
  throw new Error("Syntax WASM provenance mismatch");
await mkdir("report/release", { recursive: true });
const pack = JSON.parse(
  execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", "report/release"],
    { encoding: "utf8" },
  ),
)[0];
const bytes = await readFile(`report/release/${pack.filename}`);
await writeFile(
  "report/release/SHA256SUMS",
  `${hash(bytes)}  ${pack.filename}\n`,
);
await writeFile(
  "report/release/build.json",
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(pack.filename);
