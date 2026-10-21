import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSyntaxParser } from "../dist/syntax.js";
const bytes = new Uint8Array(
  await readFile(
    new URL("../dist/syntax/wasmtypst_syntax_bg.wasm", import.meta.url),
  ),
);
const parser = await createSyntaxParser(bytes);
const source =
  "= 결과😀\r\nA *strong* _emphasis_ $frac(1, 2)$\r\n\r\n#let x = [raw]";
const tree = parser.parse(source);
assert.equal(tree.to, source.length);
const nodes = [];
const walk = (n) => {
  nodes.push(n);
  for (const child of n.children) walk(child);
};
walk(tree);
for (const kind of ["Heading", "Strong", "Emph", "Equation", "LetBinding"])
  assert.ok(
    nodes.some((n) => n.kind === kind),
    kind,
  );
for (const node of nodes) {
  assert.ok(node.from >= 0 && node.to >= node.from && node.to <= source.length);
  assert.ok(
    node.children.every(
      (child) => child.from >= node.from && child.to <= node.to,
    ),
  );
}
assert.equal(await createSyntaxParser(), parser);
assert.throws(() => parser.parse("x".repeat(8_000_001)));
assert.equal(parser.parse("Recovered").to, 9);
const input =
  "= Heading\n\nA *real* paragraph with _emphasis_ and $x^2$.\n\n".repeat(200);
const times = [];
for (let i = 0; i < 25; i++) {
  const start = performance.now();
  parser.parse(input + String(i));
  times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
console.log(
  JSON.stringify({
    syntaxBytes: bytes.length,
    inputUtf16: input.length,
    warmP50: times[12],
    warmP95: times[23],
  }),
);
console.log(
  "Syntax: native Typst grammar, UTF-16 ranges, invalid input, bounded admission and recovery passed.",
);

const { createCompiler } = await import("../dist/node.js");
const compiler = await createCompiler({
  files: { "main.typ": "😀 $frac(1, 2)$" },
});
try {
  const html = await compiler.compileHtml({ math: true });
  assert.equal(html.success, true);
  assert.equal(html.math.length, 1);
  assert.deepEqual(html.math[0].location, {
    path: "main.typ",
    from: 3,
    to: 15,
  });
  assert.ok(html.math[0].html.includes("<mfrac"));
  assert.deepEqual((await compiler.compileHtml()).math, []);
} finally {
  compiler.dispose();
}
