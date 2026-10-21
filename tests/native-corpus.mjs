import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { allCases } from "./fixtures/corpus/cases.mjs";
import {
  verifyCorpusFixtures,
  readText,
  readBytes,
} from "./corpus-fixtures.mjs";
const binary = process.env.TYPST_NATIVE_BIN;
assert.ok(
  binary,
  "Set TYPST_NATIVE_BIN to the official Typst 0.15.1 executable",
);
const version = execFileSync(binary, ["--version"], {
  encoding: "utf8",
}).trim();
assert.match(version, /^typst 0\.15\.1 /);
const { lock } = await verifyCorpusFixtures();
const cases = (await allCases(readText, readBytes)).filter((item) =>
  item.name.startsWith("upstream-"),
);
const temporary = await mkdtemp(join(tmpdir(), "wasmtypst-native-corpus-"));
const report = {
  version,
  binarySha256: createHash("sha256")
    .update(await readFile(binary))
    .digest("hex"),
  results: [],
};
await mkdir("report/native-corpus", { recursive: true });
try {
  for (const resource of lock) {
    const match = /^@([^/]+)\/([^:]+):([^/]+)\/(.+)$/.exec(resource.path);
    if (!match) continue;
    const path = join(
      temporary,
      "packages",
      match[1],
      match[2],
      match[3],
      match[4],
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, await readBytes(resource.fixture));
  }
  for (const item of cases) {
    const project = join(temporary, item.name);
    for (const [path, bytes] of Object.entries(item.files)) {
      const target = join(project, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    const output = resolve(`report/native-corpus/${item.name}.pdf`);
    const result = spawnSync(
      binary,
      [
        "compile",
        "--ignore-system-fonts",
        "--font-path",
        resolve("tests/fixtures"),
        "--package-path",
        join(temporary, "packages"),
        "--package-cache-path",
        join(temporary, "packages"),
        "--creation-timestamp",
        "1792540800",
        "--root",
        project,
        join(project, item.entry),
        output,
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    await writeFile(
      `report/native-corpus/${item.name}.log`,
      result.stderr ?? "",
    );
    assert.ifError(result.error);
    if (item.expectedError) {
      assert.equal(
        result.status,
        1,
        `${item.name}: native compatibility contract changed`,
      );
      assert.ok(
        result.stderr.includes(item.expectedError.message),
        `${item.name}: native error differs from WASM`,
      );
      report.results.push({
        name: item.name,
        status: "same-upstream-error",
        diagnostic: item.expectedError,
      });
    } else {
      assert.equal(result.status, 0, `${item.name}: ${result.stderr}`);
      const text = execFileSync("pdftotext", [output, "-"], {
        encoding: "utf8",
      }).replace(/\s+/g, " ");
      for (const required of item.containsPdf)
        assert.ok(
          text.includes(required),
          `${item.name}: native PDF missing ${required}`,
        );
      report.results.push({
        name: item.name,
        status: item.resourceLimit
          ? "native-export-succeeds-wasm-resource-limit"
          : "native-export-succeeds",
        pdfBytes: (await readFile(output)).length,
      });
    }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
  await writeFile("report/native-corpus.json", JSON.stringify(report, null, 2));
}
console.log(
  `${cases.length} upstream cases checked against official ${version}; report/native-corpus.json`,
);
