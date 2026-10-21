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
