import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createCompiler } from "../dist/node.js";
import { chromium, firefox, webkit } from "playwright";
const port = Number(process.env.PORT ?? 8789);
const server = spawn(
  process.execPath,
  [new URL("../scripts/serve.mjs", import.meta.url).pathname],
  {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "inherit"],
  },
);
await new Promise((done, reject) => {
  server.once("error", reject);
  server.once("exit", () => reject(new Error("Server failed")));
  server.stdout.once("data", done);
});
await mkdir("report", { recursive: true });
const evidence = {
  measuredAt: new Date().toISOString(),
  build: JSON.parse(await readFile("dist/build.json")),
  browsers: {},
};
try {
  const nodeCompiler = await createCompiler({
    files: {
      "main.typ": await readFile("tests/fixtures/navigation.typ", "utf8"),
    },
  });
  try {
    const result = await nodeCompiler.compile();
    assert.equal(result.success, true);
    evidence.nodePdfSha256 = createHash("sha256")
      .update(await nodeCompiler.pdf(result.revision))
      .digest("hex");
  } finally {
    nodeCompiler.dispose();
  }
  for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      const requests = [];
      page.on("request", (r) =>
        requests.push({ url: r.url(), method: r.method() }),
      );
      await page.goto(`http://127.0.0.1:${port}/web/proof.html`);
      await page.waitForFunction(() => window.proof?.done, null, {
        timeout: 120_000,
      });
      const proof = await page.evaluate(() => window.proof);
      evidence.browsers[name] = { version: browser.version(), requests, proof };
      await writeFile(
        `report/browser-${name}.json`,
        JSON.stringify(evidence.browsers[name], null, 2),
      );
      assert.equal(proof.error, undefined, `${name}: ${proof.error}`);
      assert.equal(
        proof.result.pdfSha256,
        evidence.nodePdfSha256,
        "Browser and Node PDF bytes must match",
      );
      assert.equal(proof.result.languageCapabilities, 8);
      assert.equal(proof.result.plugin, true);
      assert.equal(proof.result.customFont, true);
      assert.ok(proof.result.large.sourceBytes >= 1048576);
      assert.equal(
        requests.filter((r) => r.url.endsWith("wasmtypst_bg.wasm")).length,
        1,
        "Exactly one compiler module must load",
      );
      assert.ok(
        requests.every(
          (r) =>
            r.method === "GET" &&
            (r.url.startsWith(`http://127.0.0.1:${port}/`) ||
              r.url.startsWith("blob:")),
        ),
        "External request or source upload",
      );
      console.log(
        `${name}: all capabilities and navigation passed; edit p95=${proof.result.editToPaint.p95.toFixed(1)}ms, large p95=${proof.result.large.editToPaint.p95.toFixed(1)}ms`,
      );
    } finally {
      await browser.close();
    }
  }
  await writeFile(
    "report/browser-results.json",
    JSON.stringify(evidence, null, 2),
  );
} finally {
  server.kill("SIGTERM");
}
