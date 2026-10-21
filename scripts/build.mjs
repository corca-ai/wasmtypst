import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { verifyMemoryLimit } from "./wasm-memory-limit.mjs";
const root = resolve(import.meta.dirname, "..");
process.chdir(root);
let lock;
try {
  lock = await open(".build.lock", "wx");
} catch {
  throw new Error(
    "Build lock exists; another build is running or an interrupted build needs inspection",
  );
}
try {
  await lock.writeFile(String(process.pid));
  const run = (name, args) => execFileSync(name, args, { stdio: "inherit" });
  const version = execFileSync("wasm-bindgen", ["--version"], {
    encoding: "utf8",
  }).trim();
  if (version !== "wasm-bindgen 0.2.128")
    throw new Error(`Expected wasm-bindgen 0.2.128, got ${version}`);
  run("cargo", [
    "build",
    "--locked",
    "--workspace",
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
  await mkdir("dist/syntax", { recursive: true });
  run("wasm-bindgen", [
    "--target",
    "web",
    "--out-dir",
    "dist/syntax",
    "--out-name",
    "wasmtypst_syntax",
    "target/wasm32-unknown-unknown/release/wasmtypst_syntax.wasm",
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
  if (optimized)
    run(resolve("node_modules/.bin/wasm-opt"), [
      "-Oz",
      "--enable-bulk-memory",
      "--enable-nontrapping-float-to-int",
      "--enable-sign-ext",
      "--enable-mutable-globals",
      "--enable-reference-types",
      "--enable-multivalue",
      "dist/syntax/wasmtypst_syntax_bg.wasm",
      "-o",
      "dist/syntax/optimized.wasm",
    ]);
  if (optimized) {
    const { rename } = await import("node:fs/promises");
    await rename(
      "dist/syntax/optimized.wasm",
      "dist/syntax/wasmtypst_syntax_bg.wasm",
    );
  }
  run(resolve("node_modules/.bin/tsc"), []);
  run(process.execPath, [resolve("scripts/notices.mjs")]);
  // The browser loader supplies bytes; keep bundlers from emitting the >25 MiB raw
  // module through wasm-bindgen's unused default-URL branch.
  const bindingPath = "dist/wasm/wasmtypst.js";
  const binding = await readFile(bindingPath, "utf8");
  const defaultUrl = "new URL('wasmtypst_bg.wasm', import.meta.url)";
  if (!binding.includes(defaultUrl))
    throw new Error("wasm-bindgen default URL contract changed");
  await writeFile(bindingPath, binding.replace(defaultUrl, "undefined"));
  const wasm = await readFile("dist/wasm/wasmtypst_bg.wasm");
  await writeFile(
    "dist/wasm/wasmtypst_bg.wasm.gz",
    gzipSync(wasm, { level: 9 }),
  );
  const { default: initialize, TypstEngine } = await import(
    "../dist/wasm/wasmtypst.js"
  );
  const exports = await initialize({ module_or_path: wasm });
  const metadataEngine = new TypstEngine();
  const memoryLimit = metadataEngine.memory_limit();
  metadataEngine.free();
  verifyMemoryLimit(exports.memory, memoryLimit);
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const receipt = {
    optimized,
    typstVersion: "0.15.1",
    wasmLinearMemoryLimitBytes: memoryLimit,
    wasmBindgenVersion: version,
    rustc: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
    cargoLockSha256: sha256(await readFile("Cargo.lock")),
    syntax: {
      bytes: (await readFile("dist/syntax/wasmtypst_syntax_bg.wasm")).length,
      sha256: sha256(await readFile("dist/syntax/wasmtypst_syntax_bg.wasm")),
    },
    wasm: {
      bytes: wasm.byteLength,
      gzipBytes: gzipSync(wasm, { level: 9 }).byteLength,
      sha256: sha256(wasm),
    },
  };
  await writeFile("dist/build.json", `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await lock.close();
  await unlink(".build.lock");
}
