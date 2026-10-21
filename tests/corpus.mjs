import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createCompiler } from "../dist/node.js";
import { createResourceLoader } from "../dist/resources.js";
import { chromium, firefox, webkit } from "playwright";
import { corpusCases } from "./fixtures/corpus/cases.mjs";
import { runCorpus } from "./fixtures/corpus/run.mjs";
const fixture = (path) => new URL(`./fixtures/${path}`, import.meta.url);
const lock = JSON.parse(
  await readFile(fixture("corpus/resources.json"), "utf8"),
);
const cases = await corpusCases((path) => readFile(fixture(path), "utf8"));
const report = {
  measuredAt: new Date().toISOString(),
  build: JSON.parse(await readFile("dist/build.json")),
  node: process.version,
  platform: process.platform,
  results: {},
};
const samples = Number(process.env.CORPUS_SAMPLES ?? 3);
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 100)
  throw new Error("Invalid CORPUS_SAMPLES");
await mkdir("report", { recursive: true });
let server;
try {
  report.results.node = await runCorpus(
    createCompiler,
    createResourceLoader,
    cases,
    lock,
    async (path) => new Uint8Array(await readFile(fixture(path))),
    samples,
  );
  report.nodePeakRssKiB = process.resourceUsage().maxRSS;
  const port = Number(process.env.CORPUS_PORT ?? 8791);
  server = spawn(
    process.execPath,
    [new URL("../scripts/serve.mjs", import.meta.url).pathname],
    {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", () => reject(new Error("Corpus server exited")));
    server.stdout.once("data", resolve);
  });
  for (const [name, engine] of Object.entries({
    chromium,
    firefox,
    webkit,
    "chromium-throttled": chromium,
  })) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage(
        name === "chromium-throttled"
          ? { viewport: { width: 390, height: 844 }, isMobile: true }
          : {},
      );
      if (name === "chromium-throttled") {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      }
      // A separate blank same-origin page avoids running the existing proof workload.
      await page.goto(
        `http://127.0.0.1:${port}/tests/fixtures/corpus/runner.html`,
      );
      const result = await page.evaluate(
        async ({ cases, lock, samples }) => {
          const { createCompiler } = await import("/dist/index.js");
          const { createResourceLoader } = await import("/dist/resources.js");
          const { runCorpus } = await import("/tests/fixtures/corpus/run.mjs");
          return runCorpus(
            createCompiler,
            createResourceLoader,
            cases,
            lock,
            async (path) =>
              new Uint8Array(
                await (await fetch(`/tests/fixtures/${path}`)).arrayBuffer(),
              ),
            samples,
          );
        },
        { cases, lock, samples },
      );
      assert.deepEqual(
        result.results.map((item) => item.pdfSha256),
        report.results.node.results.map((item) => item.pdfSha256),
        `${name}: PDF bytes differ from Node`,
      );
      report.results[name] = {
        version: browser.version(),
        pageCpuThrottle: name === "chromium-throttled" ? 4 : 1,
        ...result,
      };
      console.log(`${name}: ${result.results.length} corpus cases passed`);
    } finally {
      await browser.close();
    }
  }
} finally {
  server?.kill();
  await writeFile("report/corpus.json", JSON.stringify(report, null, 2));
}
console.log(
  "Node and three-browser document corpus passed; report/corpus.json",
);
