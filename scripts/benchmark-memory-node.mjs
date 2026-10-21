import { readFile, writeFile } from "node:fs/promises";
import { createCompiler } from "../dist/node.js";
import { allCases } from "../tests/fixtures/corpus/cases.mjs";
import { readText, readBytes } from "../tests/corpus-fixtures.mjs";
import { probeMemory } from "../tests/fixtures/corpus/memory-probe.mjs";
if (process.versions.bun)
  throw new Error("Memory RSS measurements require Node");
const mib = Number(process.argv[2]);
if (![256, 512, 1024].includes(mib))
  throw new Error("Expected memory profile 256, 512 or 1024");
const item = (await allCases(readText, readBytes)).find(
  (item) => item.largeRaster,
);
const wasm = new Uint8Array(
  await readFile(`tests/fixtures/.memory-profiles/${mib}/wasmtypst_bg.wasm`),
);
const result = await probeMemory(
  createCompiler,
  { wasm },
  item,
  await readBytes("noto-sans/NotoSans.ttf"),
);
result.processPeakRssKiB = process.resourceUsage().maxRSS;
result.node = process.version;
await writeFile(
  `report/memory-node-${mib}.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ mib, ...result }));
