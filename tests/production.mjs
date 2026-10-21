import assert from "node:assert/strict";
import { createCompiler } from "../dist/node.js";
const compiler = await createCompiler({
  files: { "main.typ": "= Semantic\nA *strong* statement with $x^2$." },
});
try {
  const html = await compiler.compileHtml();
  assert.equal(html.success, true, JSON.stringify(html.diagnostics));
  assert.match(html.html, /<h2/);
  assert.match(html.html, /<strong/);
  assert.match(html.html, /<math/);
  const rev = (await compiler.stats()).revision;
  await assert.rejects(
    compiler.snapshot({ files: { "../bad": "oops" }, entry: "main.typ" }),
    /Paths/,
  );
  assert.equal((await compiler.stats()).revision, rev);
  assert.deepEqual(await compiler.compileHtml(), html);
  await compiler.snapshot({
    files: { "main.typ": '#include "part.typ"', "part.typ": "Included" },
    entry: "main.typ",
  });
  const result = await compiler.compile();
  assert.equal(result.success, true);
  assert.equal(result.revision, rev + 1);
  await assert.rejects(compiler.pdf(rev), /Stale/);
  await compiler.snapshot({
    files: { "main.typ": '#include "part.typ"' },
    entry: "main.typ",
  });
  assert.equal((await compiler.compile()).success, false);
} finally {
  compiler.dispose();
}
let release;
const gate = new Promise((resolve) => {
  release = resolve;
});
let entered;
const enteredGate = new Promise((resolve) => {
  entered = resolve;
});
const resolver = await createCompiler({
  files: { "main.typ": '#include "missing.typ"' },
  async resolveFile() {
    entered();
    await gate;
    return "Late dependency";
  },
});
try {
  const compiling = resolver.compile();
  const rejected = assert.rejects(compiling, /superseded/);
  await enteredGate;
  await resolver.snapshot({
    files: { "main.typ": "New document" },
    entry: "main.typ",
  });
  release();
  await rejected;
  const current = await resolver.compile();
  assert.equal(current.success, true);
  assert.ok(
    !current.dependencies.includes("missing.typ") ||
      current.missingFiles.includes("missing.typ"),
  );
} finally {
  release();
  resolver.dispose();
}
console.log(
  "HTML, atomic replacement, deletion, stale export and resolver race passed",
);

const { CompilerSession } = await import("../dist/node.js");
const session = new CompilerSession(() => createCompiler());
try {
  const first = session.compile({
    files: { "main.typ": "First" },
    entry: "main.typ",
  });
  const firstRejected = assert.rejects(first, { name: "AbortError" });
  const second = session.compile({
    files: { "main.typ": "Second" },
    entry: "main.typ",
  });
  const secondRejected = assert.rejects(second, { name: "AbortError" });
  const last = session.compile(
    { files: { "main.typ": "Latest" }, entry: "main.typ" },
    { target: "html" },
  );
  await Promise.all([firstRejected, secondRejected]);
  assert.match((await last).html, /Latest/);
  const abort = new AbortController();
  const cancelled = session.compile(
    { files: { "main.typ": "#while true {}" }, entry: "main.typ" },
    { signal: abort.signal },
  );
  const cancelledRejected = assert.rejects(cancelled, { name: "AbortError" });
  abort.abort();
  await cancelledRejected;
  const recovered = await session.compile({
    files: { "main.typ": "Recovered" },
    entry: "main.typ",
  });
  assert.equal(recovered.success, true);
} finally {
  session.dispose();
}
console.log("Latest-only scheduling, cancellation and worker recovery passed");

// The actual module refuses growth beyond its 256 MiB linear-memory ceiling.
const bindings = await import("../dist/wasm/wasmtypst.js");
const { readFile } = await import("node:fs/promises");
const output = await bindings.default({
  module_or_path: new Uint8Array(
    await readFile(new URL("../dist/wasm/wasmtypst_bg.wasm", import.meta.url)),
  ),
});
assert.throws(() => output.memory.grow(4096), RangeError);
const bounded = new CompilerSession(() => createCompiler({ timeoutMs: 5000 }));
try {
  await assert.rejects(
    bounded.compile({
      entry: "main.typ",
      files: {
        "main.typ": "#let values = (" + "0,".repeat(4 * 1024 * 1024) + ")",
      },
    }),
  );
  assert.equal(
    (
      await bounded.compile({
        entry: "main.typ",
        files: { "main.typ": "Recovered after resource refusal" },
      })
    ).success,
    true,
  );
} finally {
  bounded.dispose();
}
console.log(
  "Real WASM memory ceiling and recovery after resource exhaustion passed",
);

const demo = await readFile(
  new URL("../web/index.html", import.meta.url),
  "utf8",
);
const source = demo.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)?.[1];
assert.ok(source);
const example = await createCompiler({ files: { "main.typ": source } });
try {
  assert.equal((await example.compile()).success, true);
  const html = await example.compileHtml();
  assert.equal(html.success, true, JSON.stringify(html.diagnostics));
  assert.match(html.html, /<svg/);
  assert.ok(
    !html.diagnostics.some((d) => d.message.includes("rect was ignored")),
  );
} finally {
  example.dispose();
}
console.log(
  "The actual interactive example retains its diagram in both output targets",
);

let ownedCompiler;
const retired = new CompilerSession(async () => {
  ownedCompiler = await createCompiler();
  return ownedCompiler;
});
try {
  assert.equal(
    (
      await retired.compile({
        entry: "main.typ",
        files: { "main.typ": "Before retirement" },
      })
    ).success,
    true,
  );
  ownedCompiler.dispose();
  assert.equal(ownedCompiler.isDisposed, true);
  assert.equal(
    (
      await retired.compile({
        entry: "main.typ",
        files: { "main.typ": "After retirement" },
      })
    ).success,
    true,
  );
} finally {
  retired.dispose();
}
console.log("The next snapshot recovers a worker retired outside compilation");
