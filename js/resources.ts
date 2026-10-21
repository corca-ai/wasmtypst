/** Optional host-side, integrity-locked package/font delivery. No implicit registry. */
export interface LockedResource {
  path: string;
  url: string;
  sha256: string;
  bytes: number;
}
export interface ResourceCache {
  get(
    key: string,
    signal: AbortSignal,
  ): Promise<Uint8Array<ArrayBuffer> | null>;
  put(
    key: string,
    bytes: Uint8Array<ArrayBuffer>,
    signal: AbortSignal,
  ): Promise<void>;
}
export interface ResourceLoaderOptions {
  resources: readonly LockedResource[];
  cache?: ResourceCache;
  fetch?: typeof globalThis.fetch;
  offline?: boolean;
  timeoutMs?: number;
  maxResourceBytes?: number;
}

/** Freeze one host-authorized lock inventory; unknown paths never cause I/O. */
export function createResourceLoader(options: ResourceLoaderOptions) {
  const maximum = options.maxResourceBytes ?? 16 * 1024 * 1024;
  const timeout = options.timeoutMs ?? 15_000;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > 64 * 1024 * 1024
  )
    throw new Error("Resource byte limit must be between 1 and 64 MiB");
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647)
    throw new Error("Invalid resource timeout");
  if (options.resources.length > 4096)
    throw new Error("Too many locked resources");
  const inventory = new Map<string, Readonly<LockedResource>>();
  for (const resource of options.resources) {
    const url = new URL(resource.url);
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      throw new Error(
        "Locked resource URLs must be HTTPS without credentials or fragments",
      );
    if (
      !resource.path ||
      /[\\\u0000-\u001f]/.test(resource.path) ||
      resource.path
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    )
      throw new Error("Invalid locked resource path");
    if (!/^[a-f0-9]{64}$/.test(resource.sha256))
      throw new Error("Invalid SHA-256");
    if (
      !Number.isSafeInteger(resource.bytes) ||
      resource.bytes < 0 ||
      resource.bytes > maximum
    )
      throw new Error("Locked resource exceeds byte limit");
    if (inventory.has(resource.path))
      throw new Error("Duplicate locked resource path");
    inventory.set(resource.path, Object.freeze({ ...resource }));
  }
  const cache = options.cache;
  const fetchResource = options.fetch ?? globalThis.fetch;
  const offline = options.offline ?? false;
  async function verify(
    bytes: Uint8Array<ArrayBuffer>,
    resource: Readonly<LockedResource>,
  ) {
    if (bytes.byteLength !== resource.bytes)
      throw new Error(`Resource size mismatch: ${resource.path}`);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hash = Array.from(digest, (value) =>
      value.toString(16).padStart(2, "0"),
    ).join("");
    if (hash !== resource.sha256)
      throw new Error(`Resource integrity mismatch: ${resource.path}`);
  }
  return {
    async resolveFile(
      path: string,
      callerSignal?: AbortSignal,
    ): Promise<Uint8Array<ArrayBuffer> | null> {
      const resource = inventory.get(path);
      if (!resource) return null;
      const deadline = AbortSignal.timeout(timeout);
      const signal = callerSignal
        ? AbortSignal.any([callerSignal, deadline])
        : deadline;
      signal.throwIfAborted();
      // Content-addressed keys permit sharing only identical authorized content.
      const key = `wasmtypst/sha256/${resource.sha256}`;
      const cached = await cache?.get(key, signal);
      signal.throwIfAborted();
      if (cached) {
        // Never trust persistent cache contents, and never expose cache-owned buffers.
        if (cached.byteLength !== resource.bytes)
          throw new Error(`Resource size mismatch: ${resource.path}`);
        const bytes = new Uint8Array(cached);
        await verify(bytes, resource);
        signal.throwIfAborted();
        return bytes;
      }
      if (offline) throw new Error(`Offline resource unavailable: ${path}`);
      const response = await fetchResource(resource.url, {
        signal,
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
      if (!response.ok || (!response.body && resource.bytes > 0)) {
        await response.body?.cancel();
        throw new Error(
          `Resource request failed (${response.status}): ${path}`,
        );
      }
      // Bound decoded bytes even for chunked responses and dishonest Content-Length.
      const reader = response.body?.getReader();
      const bytes = new Uint8Array(resource.bytes);
      let offset = 0;
      try {
        while (reader) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          signal.throwIfAborted();
          if (done) break;
          if (value.byteLength > bytes.byteLength - offset)
            throw new Error(`Resource exceeds locked size: ${path}`);
          bytes.set(value, offset);
          offset += value.byteLength;
        }
      } finally {
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
      }
      if (offset !== bytes.byteLength)
        throw new Error(`Resource size mismatch: ${path}`);
      await verify(bytes, resource);
      signal.throwIfAborted();
      // Cache implementations receive their own buffer and must honor cancellation.
      await cache?.put(key, bytes.slice(), signal);
      signal.throwIfAborted();
      return bytes;
    },
  };
}
