import { writeFile, mkdir } from "node:fs/promises";
import { createCompiler } from "../dist/node.js";
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const start = performance.now();
const compiler = await createCompiler();
const coldMs = performance.now() - start;
const results = {};
try {
  for (const assets of [false, true]) {
    const files = {
      "main.typ":
        "#set text(size: 11pt)\n= Research\n" +
        Array.from(
          { length: 12 },
          (_, i) => `#include "section-${i}.typ"`,
        ).join("\n"),
    };
    for (let i = 0; i < 12; i++)
      files[`section-${i}.typ`] =
        `== Method ${i + 1}\n` +
        "Scientific writing connects evidence to a testable claim. Results are interpreted with explicit assumptions and limitations.\n\n".repeat(
          8,
        ) +
        "$ integral_0^1 x^2 dif x = 1/3 $\n#table(columns: 2, [Method], [Result], [A], [42])\n";
    if (assets)
      files["unused.bin"] = new Uint8Array(16 * 1024 * 1024).fill(255);
    await compiler.snapshot({ files, entry: "main.typ" });
    for (const target of ["paged", "html"]) {
      const times = [];
      for (let i = 0; i < 25; i++) {
        await compiler.putFile(
          "section-0.typ",
          files["section-0.typ"] + `\nRevision ${i}.`,
        );
        const begin = performance.now();
        const output = await (target === "html"
          ? compiler.compileHtml()
          : compiler.compile());
        if (!output.success)
          throw new Error(JSON.stringify(output.diagnostics));
        if (i >= 5) times.push(performance.now() - begin);
      }
      results[`${target}${assets ? "-16MiB" : ""}`] = {
        samples: times.length,
        medianMs: percentile(times, 0.5),
        p95Ms: percentile(times, 0.95),
      };
    }
  }
  const report = {
    coldMs,
    results,
    stats: await compiler.stats(),
    processPeakRssKiB: process.resourceUsage().maxRSS,
    platform: process.platform,
    node: process.version,
  };
  await mkdir("report", { recursive: true });
  await writeFile(
    "report/benchmark.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  compiler.dispose();
}
