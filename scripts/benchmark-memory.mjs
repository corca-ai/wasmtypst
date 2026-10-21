import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium, firefox, webkit } from "playwright";
import { verifyCorpusFixtures } from "../tests/corpus-fixtures.mjs";
assert.equal(
  process.versions.bun,
  undefined,
  "Use bun run benchmark:memory to measure actual Node processes",
);
await verifyCorpusFixtures();
await mkdir("report", { recursive: true });
const report = {
  measuredAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  workload:
    "API-adapted finite-volume tutorial; original full-resolution figures; five edits with PDF export",
  profiles: {},
  browsers: {},
};
const expected = (result, mib) => {
  assert.equal(
    result.observations[0].wasmLinearMemoryLimitBytes,
    mib * 1024 * 1024,
  );
  if (mib === 256) {
    assert.equal(result.status, "failed");
    assert.equal(result.phase, "pdf");
    assert.match(result.error, /unreachable/i);
  } else {
    assert.equal(result.status, "supported", `${mib} MiB workload failed`);
    assert.equal(result.pages, 7);
  }
};
let server;
try {
  for (const mib of [256, 512, 1024]) {
    const build = JSON.parse(
      await readFile(`tests/fixtures/.memory-profiles/${mib}/build.json`),
    );
    const artifact = await readFile(
      `tests/fixtures/.memory-profiles/${mib}/wasmtypst_bg.wasm`,
    );
    assert.equal(
      createHash("sha256").update(artifact).digest("hex"),
      build.wasm.sha256,
    );
    execFileSync(
      process.execPath,
      ["scripts/verify-memory-profile.mjs", String(mib)],
      { stdio: "inherit" },
    );
    report.profiles[mib] = { build, maximumGrowthVerified: true, node: [] };
    for (let run = 0; run < 3; run++) {
      execFileSync(
        process.execPath,
        ["scripts/benchmark-memory-node.mjs", String(mib)],
        { stdio: ["ignore", "ignore", "inherit"] },
      );
      const result = JSON.parse(
        await readFile(`report/memory-node-${mib}.json`),
      );
      expected(result, mib);
      report.profiles[mib].node.push(result);
    }
    console.log(`Node ${mib} MiB: ${report.profiles[mib].node[0].status}`);
  }
  const port = Number(process.env.MEMORY_BENCH_PORT ?? 8793);
  server = spawn(process.execPath, ["scripts/serve.mjs"], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("exit", () => reject(new Error("Benchmark server exited")));
    server.stdout.once("data", resolve);
  });
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    report.browsers[name] = {};
    for (const mib of [256, 512, 1024]) {
      const browser = await engine.launch();
      try {
        const page = await browser.newPage();
        await page.goto(
          `http://127.0.0.1:${port}/tests/fixtures/corpus/runner.html`,
        );
        const result = await page.evaluate(async (mib) => {
          const { createCompiler } = await import("/dist/index.js");
          const { allCases } = await import("/tests/fixtures/corpus/cases.mjs");
          const { probeMemory } = await import(
            "/tests/fixtures/corpus/memory-probe.mjs"
          );
          const readText = async (path) =>
            (await fetch(`/tests/fixtures/${path}`)).text();
          const readBytes = async (path) =>
            new Uint8Array(
              await (await fetch(`/tests/fixtures/${path}`)).arrayBuffer(),
            );
          const item = (await allCases(readText, readBytes)).find(
            (item) => item.largeRaster,
          );
          return probeMemory(
            createCompiler,
            {
              wasm: new URL(
                `/tests/fixtures/.memory-profiles/${mib}/wasmtypst_bg.wasm`,
                location.href,
              ),
            },
            item,
            await readBytes("noto-sans/NotoSans.ttf"),
          );
        }, mib);
        expected(result, mib);
        report.browsers[name][mib] = { version: browser.version(), ...result };
        console.log(`${name} ${mib} MiB: ${result.status}`);
      } finally {
        await browser.close();
      }
    }
  }
  const supported = [512, 1024].filter(
    (mib) =>
      report.profiles[mib].node.every(
        (result) => result.status === "supported",
      ) &&
      Object.values(report.browsers).every(
        (browser) => browser[mib].status === "supported",
      ),
  );
  assert.deepEqual(
    supported,
    [512, 1024],
    "Both larger profiles must support the workload in all runtimes",
  );
  report.minimumQualifiedLimitMiB = supported[0];
  const hash = report.profiles[supported[0]].node[0].pdfSha256;
  for (const mib of supported) {
    for (const result of report.profiles[mib].node)
      assert.equal(result.pdfSha256, hash);
    for (const browser of Object.values(report.browsers))
      assert.equal(browser[mib].pdfSha256, hash);
  }
} finally {
  server?.kill();
  await writeFile(
    "report/memory-profiles.json",
    JSON.stringify(report, null, 2),
  );
}
console.log("Memory profile matrix passed; report/memory-profiles.json");
