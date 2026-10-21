import { createCompiler } from "/dist/index.js";
import { Preview } from "/dist/preview.js";
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const percentile = (samples, p) =>
  [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1];
const summary = (samples) => ({
  samples: samples.length,
  p50: percentile(samples, 0.5),
  p95: percentile(samples, 0.95),
  max: Math.max(...samples),
});
const started = performance.now();
const source = await (await fetch("/tests/fixtures/navigation.typ")).text();
const host = document.querySelector("#preview");
let compiler;
let view;
async function paint(result) {
  await view.render(result);
  await Promise.all(
    [...host.querySelectorAll("img")].map((image) => image.decode()),
  );
  await new Promise((done) =>
    requestAnimationFrame(() => requestAnimationFrame(done)),
  );
}
window.proof = { done: false };
try {
  compiler = await createCompiler({ files: { "main.typ": source } });
  view = new Preview(host, compiler);
  const first = await compiler.compile();
  check(first.success, JSON.stringify(first.diagnostics));
  await paint(first);
  const coldMs = performance.now() - started;
  const firstPdf = await compiler.pdf(first.revision);
  const pdfSha256 = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", firstPdf)),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const navigation = {};
  for (const needle of [
    "ProseMARK",
    "719",
    "FigureMARK",
    "TableMARK",
    "NestedMARK",
  ]) {
    const offset = source.indexOf(needle);
    const points = await compiler.sourceToOutput(
      first.revision,
      "main.typ",
      offset,
    );
    check(points.length > 0, `Missing forward navigation: ${needle}`);
    const point = { ...points[0], x: points[0].x + 1, y: points[0].y - 2 };
    const back = await compiler.outputToSource(first.revision, point);
    check(
      back?.path === "main.typ" &&
        back.from >= offset &&
        back.from <= offset + needle.length,
      `Wrong reverse navigation: ${needle}: ${JSON.stringify(back)}`,
    );
    navigation[needle] = { forward: points, reverse: back };
  }
  let clickJump;
  view.addEventListener("navigate", ({ detail }) => {
    clickJump = detail;
  });
  const image = host.querySelector("img");
  const rect = image.getBoundingClientRect();
  const position = navigation.ProseMARK.forward[0];
  image.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      clientX:
        rect.left + ((position.x + 1) * rect.width) / first.pages[0].width,
      clientY:
        rect.top + ((position.y - 2) * rect.height) / first.pages[0].height,
    }),
  );
  for (let i = 0; i < 100 && !clickJump; i++)
    await new Promise((done) => setTimeout(done, 10));
  check(clickJump?.path === "main.typ", "Preview click did not navigate");
  const offset = source.lastIndexOf("#answer") + 1;
  check(
    (await compiler.definition("main.typ", offset))?.from ===
      source.indexOf("answer="),
    "Definition did not resolve binding",
  );
  check(
    (await compiler.references("main.typ", offset)).length === 2,
    "References failed",
  );
  check(
    (await compiler.rename("main.typ", offset, "result")).edits.length === 2,
    "Rename failed",
  );
  check(
    (await compiler.hover("main.typ", offset))?.text.includes("42"),
    "Hover failed",
  );
  check(
    (await compiler.completion("main.typ", source.indexOf("#figure") + 3)).items
      .length > 0,
    "Completion failed",
  );
  check(
    (await compiler.format("main.typ")).text.includes("answer = 42"),
    "Formatting failed",
  );
  check(
    (await compiler.semanticTokens("main.typ")).length > 0,
    "Semantic tokens failed",
  );
  await compiler.putFile("main.typ", "#unknown-function()");
  const invalid = await compiler.compile();
  check(
    !invalid.success &&
      invalid.diagnostics.some((d) => d.message.includes("unknown-function")),
    "Diagnostic did not identify inserted error",
  );
  let stale = false;
  try {
    await compiler.pdf(first.revision);
  } catch {
    stale = true;
  }
  check(stale, "Stale PDF was accepted");
  const editTimes = [],
    compileTimes = [],
    pdfTimes = [];
  for (let i = 0; i < 21; i++) {
    const start = performance.now();
    await compiler.putFile("main.typ", source + `\nTail ${i}`);
    const compilationStart = performance.now();
    const result = await compiler.compile();
    const compileMs = performance.now() - compilationStart;
    check(result.success, "Incremental compile failed");
    await paint(result);
    if (i) {
      editTimes.push(performance.now() - start);
      compileTimes.push(compileMs);
    }
    const pdfStart = performance.now();
    const pdf = await compiler.pdf(result.revision);
    check(
      new TextDecoder().decode(pdf.subarray(0, 5)) === "%PDF-",
      "Invalid PDF bytes",
    );
    if (i) pdfTimes.push(performance.now() - pdfStart);
  }
  // Same World also executes a real package WASM plugin supplied by the host.
  for (const name of ["typst.toml", "lib.typ", "plugin.wasm"]) {
    const response = await fetch(`/tests/fixtures/cmarker/${name}`);
    await compiler.putFile(
      `@preview/cmarker:0.1.8/${name}`,
      new Uint8Array(await response.arrayBuffer()),
    );
  }
  await compiler.putFile(
    "main.typ",
    '#import "@preview/cmarker:0.1.8"\n#cmarker.render("**PluginMARK**")',
  );
  const plugin = await compiler.compile();
  check(plugin.success, JSON.stringify(plugin.diagnostics));
  check(
    (await compiler.pdf(plugin.revision)).byteLength > 1000,
    "Plugin export failed",
  );
  const fontResponse = await fetch("/tests/fixtures/Roboto-Regular.ttf");
  await compiler.addFont(new Uint8Array(await fontResponse.arrayBuffer()));
  await compiler.putFile("main.typ", '#set text(font: "Roboto")\nCustomFONT');
  const customFont = await compiler.compile();
  check(
    customFont.success &&
      !customFont.diagnostics.some((d) => d.message.includes("unknown font")),
    "Project font was not admitted",
  );
  const largeText = "//" + "X".repeat(10700) + "\nLargeMARK\n";
  const imports = [];
  for (let i = 0; i < 99; i++) {
    const path = `sections/${i}.typ`;
    await compiler.putFile(path, largeText);
    imports.push(`#include "${path}"`);
  }
  const mainLarge = imports.join("\n");
  const largeTimes = [];
  for (let i = 0; i < 21; i++) {
    const start = performance.now();
    await compiler.putFile("main.typ", mainLarge + `\nLarge tail ${i}`);
    const result = await compiler.compile();
    check(result.success, "Large project failed");
    await paint(result);
    if (i) largeTimes.push(performance.now() - start);
  }
  const { HtmlPreview } = await import("/dist/html-preview.js");
  await compiler.snapshot({
    files: {
      "main.typ": "= SemanticHTML\nA *selectable* document with $x^2$.",
    },
    entry: "main.typ",
  });
  const htmlResult = await compiler.compileHtml();
  check(htmlResult.success, JSON.stringify(htmlResult.diagnostics));
  check(
    htmlResult.html.includes("<h2>") && htmlResult.html.includes("<math>"),
    "Semantic HTML missing",
  );
  const htmlHost = document.createElement("section");
  document.body.append(htmlHost);
  const htmlView = new HtmlPreview(htmlHost, {
    title: "Semantic HTML preview",
  });
  const frame = htmlHost.querySelector("iframe");
  const loaded = new Promise((resolve, reject) => {
    frame.addEventListener("load", resolve, { once: true });
    setTimeout(() => reject(new Error("HTML frame did not load")), 10000);
  });
  htmlView.render({
    ...htmlResult,
    html:
      htmlResult.html +
      "<script>window.untrustedExecuted=true;parent.untrustedExecuted=true;</script>",
  });
  await loaded;
  check(frame.contentDocument === null, "HTML preview must have opaque origin");
  check(window.untrustedExecuted !== true, "HTML script escaped sandbox");
  window.proof = {
    done: true,
    result: {
      coldMs,
      pdfSha256,
      navigation,
      languageCapabilities: 8,
      plugin: true,
      customFont: true,
      html: true,
      compile: summary(compileTimes),
      editToPaint: summary(editTimes),
      pdfExport: summary(pdfTimes),
      large: {
        files: 100,
        sourceBytes:
          new TextEncoder().encode(mainLarge).length +
          99 * new TextEncoder().encode(largeText).length,
        editToPaint: summary(largeTimes),
      },
      stats: await compiler.stats(),
      storage: { local: localStorage.length, session: sessionStorage.length },
    },
  };
} catch (error) {
  window.proof = { done: true, error: String(error.stack ?? error) };
} finally {
  view?.dispose();
  compiler?.dispose();
  document.querySelector("#status").textContent = JSON.stringify(
    window.proof,
    null,
    2,
  );
}
