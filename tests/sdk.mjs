import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createCompiler } from "../dist/node.js";
import { Compiler } from "../dist/compiler.js";
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

const htmlSource = await createCompiler({
  files: { "main.typ": "= Results😀\nA *strong* result." },
});
try {
  const mapped = await htmlSource.compileHtml({ sourceMap: true });
  assert.ok(mapped.sourceMap.length > 0);
  assert.match(mapped.html, /data-typst=/);
  assert.ok(
    mapped.sourceMap.some(
      (entry) => entry.location.from === 2 && entry.location.to === 11,
    ),
  );
  assert.deepEqual((await htmlSource.compileHtml()).sourceMap, []);
} finally {
  htmlSource.dispose();
}

// A semantic query alone discovers a package manifest and its entrypoint in
// separate native passes, even with syntactically incomplete source. No layout.
const packageSource = '#import "@preview/test:0.1.0": *\n#';
const packageFiles = {
  "@preview/test:0.1.0/typst.toml":
    '[package]\nname = "test"\nversion = "0.1.0"\nentrypoint = "lib.typ"',
  "@preview/test:0.1.0/lib.typ": "#let package-function(x) = x",
};
const semanticRequests = [];
const semantic = await createCompiler({
  files: { "main.typ": packageSource },
  resolveFile: async (path) => {
    semanticRequests.push(path);
    return packageFiles[path] ?? null;
  },
});
try {
  const result = await semantic.completion("main.typ", packageSource.length);
  assert.ok(result.items.some((item) => item.label === "package-function"));
  assert.deepEqual(semanticRequests, Object.keys(packageFiles));
  const revision = (await semantic.stats()).revision;
  await assert.rejects(semantic.pdf(revision), /compile|output/i);
  await semantic.completion("main.typ", packageSource.length);
  assert.equal(semanticRequests.length, 2, "warm queries reuse admitted files");
  const imported = '#import "@preview/test:0.1.0": *\n#package-function(1)';
  await semantic.putFile("main.typ", imported);
  const cursor = imported.lastIndexOf("package-function") + 4;
  assert.equal(
    (await semantic.definition("main.typ", cursor)).path,
    "@preview/test:0.1.0/lib.typ",
  );
  assert.ok(await semantic.hover("main.typ", cursor));
  const signature = await semantic.signature(
    "main.typ",
    imported.lastIndexOf("(1") + 1,
  );
  assert.equal(
    signature.signatures[0].parameters[signature.signatures[0].activeParameter]
      .label,
    "x",
  );
  await assert.rejects(
    semantic.rename("main.typ", cursor, "changed"),
    /package/i,
  );
  assert.equal(semanticRequests.length, 2);
} finally {
  semantic.dispose();
}

// Resolver refusal terminates discovery instead of looping.
let refused = 0;
const missing = await createCompiler({
  files: { "main.typ": packageSource },
  resolveFile: async () => {
    refused++;
    return null;
  },
});
try {
  const result = await missing.completion("main.typ", packageSource.length);
  assert.ok(!result.items.some((item) => item.label === "package-function"));
  assert.equal(refused, 1);
} finally {
  missing.dispose();
}

// Mutating/disposal while a semantic resolver waits rejects its obsolete answer.
for (const action of ["mutate", "dispose"]) {
  let entered;
  let release;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const current = await createCompiler({
    files: { "main.typ": packageSource },
    resolveFile: async (_path, signal) => {
      entered();
      await gate;
      return packageFiles["@preview/test:0.1.0/typst.toml"];
    },
  });
  try {
    const pending = current.completion("main.typ", packageSource.length);
    const rejected = assert.rejects(pending, /superseded|disposed/);
    await waiting;
    if (action === "mutate")
      await current.putFile("main.typ", "Current source");
    else current.dispose();
    release();
    await rejected;
    if (action === "mutate")
      assert.equal((await current.compile()).success, true);
  } finally {
    release();
    current.dispose();
  }
}

// Fatal transport errors retain their actionable diagnostic during semantic
// resolution, even though the transport terminates before the promise resumes.
let receiveFatal;
const fatal = new Compiler(
  {
    listen(onMessage) {
      receiveFatal = onMessage;
      return () => {};
    },
    post({ id }) {
      queueMicrotask(() =>
        receiveFatal({
          id,
          ok: false,
          error: "WASM trap: unreachable",
          fatal: true,
        }),
      );
    },
    terminate() {},
  },
  { resolveFile: async () => null },
);
await assert.rejects(fatal.completion("main.typ", 0), /WASM trap: unreachable/);
assert.equal(fatal.isDisposed, true);

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
