import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, copyFile, cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const destination = "tests/fixtures/.memory-profiles";
const receipt = JSON.parse(await readFile("dist/build.json"));
assert.equal(
  receipt.wasmLinearMemoryLimitBytes,
  512 * 1024 * 1024,
  "Build the default 512 MiB SDK before building comparison profiles",
);
assert.equal(receipt.optimized, true);
assert.equal(
  createHash("sha256")
    .update(await readFile("dist/wasm/wasmtypst_bg.wasm"))
    .digest("hex"),
  receipt.wasm.sha256,
);
const binding = await readFile("dist/wasm/wasmtypst.js", "utf8");
async function saveProfile(mib) {
  await mkdir(`${destination}/${mib}`, { recursive: true });
  for (const file of ["wasmtypst_bg.wasm", "wasmtypst_bg.wasm.gz"])
    await copyFile(`dist/wasm/${file}`, `${destination}/${mib}/${file}`);
  await copyFile("dist/build.json", `${destination}/${mib}/build.json`);
}
await mkdir(destination, { recursive: true });
await rm(`${destination}/sdk-512`, { recursive: true, force: true });
await cp("dist", `${destination}/sdk-512`, { recursive: true });
await saveProfile(512);
try {
  for (const mib of [256, 1024]) {
    execFileSync("bun", ["run", "build"], {
      stdio: "inherit",
      env: { ...process.env, WASMTYPST_MEMORY_LIMIT_MIB: String(mib) },
    });
    assert.equal(
      await readFile("dist/wasm/wasmtypst.js", "utf8"),
      binding,
      "Memory profiles have incompatible JS bindings",
    );
    await saveProfile(mib);
  }
} finally {
  await rm("dist", { recursive: true, force: true });
  await cp(`${destination}/sdk-512`, "dist", { recursive: true });
}
console.log(
  "Built 256/512/1024 MiB profiles; restored the complete 512 MiB SDK",
);
