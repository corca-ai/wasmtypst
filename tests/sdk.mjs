import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createCompiler } from "../dist/node.js";
import { instantiate } from "../dist/core.js";

execFileSync(
  process.execPath,
  [
    "--input-type=module",
    "--eval",
    `import {createCompiler} from ${JSON.stringify(new URL("../dist/node.js", import.meta.url).href)};const c=await createCompiler({files:{'main.typ':'Eval host'}});try{if(!(await c.compile()).success)throw new Error('Eval compile failed');}finally{c.dispose();}`,
  ],
  { stdio: "inherit", timeout: 10_000 },
);

const compiler = await createCompiler({
  files: { "main.typ": "= Hello\n$ x^2 $" },
});
try {
  const result = await compiler.compile();
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.equal(result.pages.length, 1);
  assert.ok(
    (await compiler.pdf(result.revision)).subarray(0, 5).toString() !== "",
  );
  const pdf = await compiler.pdf(result.revision);
  assert.equal(new TextDecoder().decode(pdf.subarray(0, 5)), "%PDF-");
  assert.match(await compiler.svg(result.revision, 1), /<svg/);
  const stats = await compiler.stats();
  assert.equal(stats.typstVersion, "0.15.1");
  assert.ok(stats.wasmLinearMemoryBytes > 0);
  await compiler.putFile("main.typ", "#unknown-function()");
  const failed = await compiler.compile();
  assert.equal(failed.success, false);
  assert.ok(
    failed.diagnostics.some((d) => d.message.includes("unknown-function")),
  );
  await assert.rejects(compiler.pdf(result.revision), /Stale/);
  await assert.rejects(compiler.putFile("../secret", "no"), /Paths/);
  await compiler.putFile("main.typ", "#let answer=42\n#answer");
  assert.equal((await compiler.references("main.typ", 19)).length, 2);
  assert.equal(
    (await compiler.rename("main.typ", 19, "result")).edits.length,
    2,
  );
  assert.match((await compiler.format("main.typ")).text, /answer = 42/);
  assert.equal((await compiler.compile()).success, true);
} finally {
  compiler.dispose();
}
await assert.rejects(compiler.compile(), /disposed/);

const isolated = await createCompiler({
  files: { "main.typ": "Separate world" },
});
try {
  assert.equal((await isolated.compile()).success, true);
} finally {
  isolated.dispose();
}

const requested = [];
const resolver = await createCompiler({
  files: {
    "main.typ":
      '#import "@preview/cmarker:0.1.8"\n#cmarker.render("**PluginMARK**")',
  },
  async resolveFile(path) {
    requested.push(path);
    const name = path.replace("@preview/cmarker:0.1.8/", "");
    if (!["typst.toml", "lib.typ", "plugin.wasm"].includes(name)) return null;
    return new Uint8Array(
      await readFile(new URL(`./fixtures/cmarker/${name}`, import.meta.url)),
    );
  },
});
try {
  const result = await resolver.compile();
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  assert.ok(requested.includes("@preview/cmarker:0.1.8/plugin.wasm"));
  assert.ok((await resolver.pdf(result.revision)).byteLength > 1000);
} finally {
  resolver.dispose();
}

// Typst bounds infinite loops; the host also enforces a hard worker deadline.
const untrusted = await createCompiler({
  timeoutMs: 2000,
  files: { "main.typ": "#while true {}" },
});
try {
  assert.equal((await untrusted.compile()).success, false);
} finally {
  untrusted.dispose();
}
await assert.rejects(createCompiler({ timeoutMs: 1 }), /timed out/);

const bytes = new Uint8Array(
  await readFile(new URL("../dist/wasm/wasmtypst_bg.wasm", import.meta.url)),
);
const core = await instantiate(bytes);
try {
  core.execute({
    kind: "put",
    path: "main.typ",
    bytes: new TextEncoder().encode("Core without DOM"),
  });
  assert.equal(
    core.execute({ kind: "query", request: { op: "compile" } }).success,
    true,
  );
} finally {
  core.dispose();
}
assert.throws(() => core.execute({ kind: "stats" }), /disposed/);
console.log(
  "SDK: Node worker, direct core, project isolation, package/plugin resolution, diagnostics, stale output, language queries and loop diagnostics and worker deadline passed.",
);
