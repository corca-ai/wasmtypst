import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
const root = resolve(import.meta.dirname, "..");
process.chdir(root);
const run = (name, args) => execFileSync(name, args, { stdio: "inherit" });
const version = execFileSync("wasm-bindgen", ["--version"], {
  encoding: "utf8",
}).trim();
if (version !== "wasm-bindgen 0.2.128")
  throw new Error(`Expected wasm-bindgen 0.2.128, got ${version}`);
run("cargo", [
  "build",
  "--locked",
  "--release",
  "--target",
  "wasm32-unknown-unknown",
]);
await mkdir("dist/wasm", { recursive: true });
run("wasm-bindgen", [
  "--target",
  "web",
  "--out-dir",
  "dist/wasm",
  "--out-name",
  "wasmtypst",
  "target/wasm32-unknown-unknown/release/wasmtypst.wasm",
]);
const optimized = !process.argv.includes("--skip-opt");
if (optimized)
  run(resolve("node_modules/.bin/wasm-opt"), [
    "-Oz",
    "--enable-bulk-memory",
    "--enable-nontrapping-float-to-int",
    "--enable-sign-ext",
    "--enable-mutable-globals",
    "--enable-reference-types",
    "--enable-multivalue",
    "dist/wasm/wasmtypst_bg.wasm",
    "-o",
    "dist/wasm/optimized.wasm",
  ]);
if (optimized) {
  const { rename } = await import("node:fs/promises");
  await rename("dist/wasm/optimized.wasm", "dist/wasm/wasmtypst_bg.wasm");
}
run(resolve("node_modules/.bin/tsc"), []);
run(process.execPath, [resolve("scripts/notices.mjs")]);
const wasm = await readFile("dist/wasm/wasmtypst_bg.wasm");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const receipt = {
  optimized,
  typstVersion: "0.15.1",
  wasmBindgenVersion: version,
  rustc: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
  cargoLockSha256: sha256(await readFile("Cargo.lock")),
  wasm: {
    bytes: wasm.byteLength,
    gzipBytes: gzipSync(wasm, { level: 9 }).byteLength,
    sha256: sha256(wasm),
  },
};
await writeFile("dist/build.json", `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
