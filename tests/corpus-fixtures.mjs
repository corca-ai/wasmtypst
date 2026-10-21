import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
export const fixture = (path) => new URL(`./fixtures/${path}`, import.meta.url);
export const readText = (path) => readFile(fixture(path), "utf8");
export const readBytes = async (path) =>
  new Uint8Array(await readFile(fixture(path)));
export async function verifyCorpusFixtures() {
  const upstream = JSON.parse(await readText("corpus/upstream.json"));
  const lock = JSON.parse(await readText("corpus/resources.json"));
  const derivatives = JSON.parse(await readText("corpus/derived-images.json"));
  for (const item of [...upstream, ...lock, ...derivatives]) {
    const bytes = await readBytes(item.fixture);
    assert.equal(
      bytes.length,
      item.bytes,
      `${item.fixture}: byte length changed`,
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      item.sha256,
      `${item.fixture}: content changed`,
    );
  }
  for (const image of derivatives) {
    const original = await readBytes(image.source);
    const resized = await readBytes(image.fixture);
    const dimensions = (bytes) => [
      new DataView(bytes.buffer).getUint32(16),
      new DataView(bytes.buffer).getUint32(20),
    ];
    assert.deepEqual(dimensions(original), image.sourceSize);
    assert.deepEqual(dimensions(resized), image.size);
    assert.ok(Math.max(...image.size) <= 1200);
  }
  return { lock, upstream, derivatives };
}
