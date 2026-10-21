import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "wasmtypst-consumer-"));
try {
  const output = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", temporary], {
      cwd: root,
      encoding: "utf8",
    }),
  );
  const archive = join(temporary, output[0].filename);
  await mkdir(join(temporary, "node_modules"));
  execFileSync("tar", ["-xzf", archive, "-C", join(temporary, "node_modules")]);
  const { rename, symlink } = await import("node:fs/promises");
  await rename(
    join(temporary, "node_modules/package"),
    join(temporary, "node_modules/wasmtypst"),
  );
  // Only typechecking the optional adapter needs its peer; the compiler has
  // no runtime dependency or application checkout in its resolution path.
  await symlink(
    resolve(root, "node_modules/monaco-editor"),
    join(temporary, "node_modules/monaco-editor"),
  );
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({ type: "module" }),
  );
  const text = `import assert from 'node:assert/strict';
import { createCompiler } from 'wasmtypst/node';
import { instantiate } from 'wasmtypst/core';
import { Preview } from 'wasmtypst/preview';
import { registerMonaco } from 'wasmtypst/monaco';
import { readFile } from 'node:fs/promises';
assert.equal(typeof instantiate,'function');assert.equal(typeof Preview,'function');assert.equal(typeof registerMonaco,'function');
const wasm=await readFile(import.meta.resolve('wasmtypst/wasm').replace('file://',''));
assert.ok(wasm.byteLength>0);
const compiler=await createCompiler({files:{'main.typ':'Packed consumer $x^2$'}});
try{const r=await compiler.compile();assert.equal(r.success,true);assert.ok((await compiler.pdf(r.revision)).length>1000);}finally{compiler.dispose();}
`;
  await writeFile(join(temporary, "consumer.mjs"), text);
  execFileSync(process.execPath, ["consumer.mjs"], {
    cwd: temporary,
    stdio: "inherit",
  });
  await writeFile(
    join(temporary, "consumer.ts"),
    `import {createCompiler, type CompileResult} from 'wasmtypst';
import {createCompiler as nodeCompiler} from 'wasmtypst/node';
import {instantiate} from 'wasmtypst/core';
import {Preview} from 'wasmtypst/preview';
import {registerMonaco} from 'wasmtypst/monaco';
const result: CompileResult = await (await nodeCompiler()).compile();
const bytes: Uint8Array = await (await createCompiler()).pdf(result.revision);
void [bytes,instantiate,Preview,registerMonaco];\n`,
  );
  execFileSync(
    resolve(root, "node_modules/.bin/tsc"),
    [
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--target",
      "ES2022",
      "--lib",
      "ES2022,DOM",
      "consumer.ts",
    ],
    { cwd: temporary, stdio: "inherit" },
  );
  const files = output[0].files.map((f) => f.path);
  assert.ok(files.includes("dist/wasm/wasmtypst_bg.wasm"));
  assert.ok(files.includes("LICENSES/typst-0.15.1/LICENSE"));
  assert.ok(files.includes("LICENSES/typst-assets-0.15.1/NOTICE"));
  assert.ok(
    !files.some(
      (f) =>
        f.startsWith("src/") ||
        f.startsWith("target/") ||
        f.startsWith("node_modules/"),
    ),
  );
  console.log(
    `Package: ${files.length} files, isolated Node runtime, all public declarations and bundled third-party notices passed.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
