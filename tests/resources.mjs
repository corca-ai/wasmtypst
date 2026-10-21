import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createResourceLoader } from "../dist/resources.js";
const body = new TextEncoder().encode("verified package bytes");
const resource = {
  path: "@preview/example:1.0.0/lib.typ",
  url: "https://packages.example/immutable/lib.typ",
  bytes: body.length,
  sha256: createHash("sha256").update(body).digest("hex"),
};
const inventory = new Map();
const cache = {
  async get(key) {
    return inventory.get(key) ?? null;
  },
  async put(key, bytes) {
    inventory.set(key, bytes);
  },
};
let calls = 0;
const fetchResource = async (url, options) => {
  calls++;
  assert.equal(url, resource.url);
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
  assert.equal(options.referrerPolicy, "no-referrer");
  return new Response(body);
};
const loader = createResourceLoader({
  resources: [resource],
  cache,
  fetch: fetchResource,
});
assert.equal(await loader.resolveFile("unapproved.typ"), null);
assert.equal(calls, 0);
const bytes = await loader.resolveFile(resource.path);
assert.deepEqual(bytes, body);
bytes.fill(0);
assert.deepEqual(await loader.resolveFile(resource.path), body);
assert.equal(calls, 1);
const offline = createResourceLoader({
  resources: [resource],
  cache,
  offline: true,
});
assert.deepEqual(await offline.resolveFile(resource.path), body);
await assert.rejects(
  createResourceLoader({ resources: [resource], offline: true }).resolveFile(
    resource.path,
  ),
  /Offline/,
);
inventory.values().next().value.fill(0);
await assert.rejects(offline.resolveFile(resource.path), /integrity/);
const failing = (response) =>
  createResourceLoader({ resources: [resource], fetch: async () => response });
await assert.rejects(
  failing(new Response(new Uint8Array(body.length))).resolveFile(resource.path),
  /integrity/,
);
await assert.rejects(
  failing(new Response(body.slice(1))).resolveFile(resource.path),
  /size mismatch/,
);
let cancelled = false;
const overflow = new ReadableStream({
  start(controller) {
    controller.enqueue(new Uint8Array(body.length + 1));
  },
  cancel() {
    cancelled = true;
  },
});
await assert.rejects(
  failing(new Response(overflow)).resolveFile(resource.path),
  /exceeds/,
);
assert.equal(cancelled, true);
await assert.rejects(
  failing(new Response(null, { status: 404 })).resolveFile(resource.path),
  /404/,
);
const aborted = new AbortController();
aborted.abort();
await assert.rejects(loader.resolveFile(resource.path, aborted.signal), {
  name: "AbortError",
});
const stalled = createResourceLoader({
  resources: [resource],
  timeoutMs: 10,
  fetch: async (_, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    }),
});
// Node's timeout signal is unref'ed; keep the process alive for this assertion.
const keepAlive = setInterval(() => {}, 1000);
try {
  await assert.rejects(stalled.resolveFile(resource.path), {
    name: "TimeoutError",
  });
} finally {
  clearInterval(keepAlive);
}
for (const patch of [
  { url: "http://example.com/x" },
  { url: "https://a:b@example.com/x" },
  { path: "../secret" },
  { sha256: "bad" },
  { bytes: -1 },
  { bytes: 17 * 1024 * 1024 },
]) {
  assert.throws(() =>
    createResourceLoader({ resources: [{ ...resource, ...patch }] }),
  );
}
assert.throws(
  () => createResourceLoader({ resources: [resource, resource] }),
  /Duplicate/,
);
// Caller mutation cannot broaden the admitted inventory after construction.
const mutable = { ...resource };
const frozen = createResourceLoader({
  resources: [mutable],
  fetch: fetchResource,
});
mutable.url = "https://unapproved.example/x";
assert.deepEqual(await frozen.resolveFile(resource.path), body);
console.log(
  "Locked resources: authorization, integrity, offline cache, bounds and cancellation passed",
);

// A late abort must interrupt an in-flight response, never publish partial bytes.
const interrupt = new AbortController();
let entered;
const reading = new Promise((resolve) => {
  entered = resolve;
});
let writes = 0;
const interrupted = createResourceLoader({
  resources: [resource],
  cache: {
    async get() {
      return null;
    },
    async put() {
      writes++;
    },
  },
  fetch: async (_, { signal }) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(body.slice(0, 1));
          signal.addEventListener(
            "abort",
            () => controller.error(signal.reason),
            { once: true },
          );
          entered();
        },
      }),
    ),
});
const partial = interrupted.resolveFile(resource.path, interrupt.signal);
const partialRejected = assert.rejects(partial, { name: "AbortError" });
await reading;
interrupt.abort();
await partialRejected;
assert.equal(writes, 0);

// Empty includes are valid Typst dependencies and have an ordinary SHA-256 identity.
const empty = {
  ...resource,
  bytes: 0,
  sha256: createHash("sha256").update(new Uint8Array()).digest("hex"),
};
for (const response of [new Response(new Uint8Array()), new Response(null)]) {
  inventory.delete(`wasmtypst/sha256/${empty.sha256}`);
  const emptyLoader = createResourceLoader({
    resources: [empty],
    cache,
    fetch: async () => response,
  });
  assert.deepEqual(await emptyLoader.resolveFile(empty.path), new Uint8Array());
}
const emptyOffline = createResourceLoader({
  resources: [empty],
  cache,
  offline: true,
});
assert.deepEqual(await emptyOffline.resolveFile(empty.path), new Uint8Array());
