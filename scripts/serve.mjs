import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { gzipSync } from "node:zlib";
const root = resolve(import.meta.dirname, "..");
const port = Number(process.env.PORT ?? 8788);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".css": "text/css",
};
const cache = new Map();
createServer(async (req, res) => {
  try {
    if (req.method !== "GET") {
      res.writeHead(405).end();
      return;
    }
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (
      path !== "/" &&
      !["/dist/", "/web/", "/tests/fixtures/"].some((p) => path.startsWith(p))
    )
      throw new Error("Not public");
    const file = resolve(root, `.${path === "/" ? "/web/index.html" : path}`);
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile())
      throw new Error("Invalid path");
    let content = cache.get(file);
    if (!content) {
      const raw = await readFile(file);
      content = { raw, gzip: gzipSync(raw, { level: 9 }) };
      cache.set(file, content);
    }
    const gzip = /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
    const body = gzip ? content.gzip : content.raw;
    res
      .writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
        "Content-Length": body.length,
        "Cache-Control": "no-store",
        Vary: "Accept-Encoding",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self'; connect-src 'self'",
        ...(gzip ? { "Content-Encoding": "gzip" } : {}),
      })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`WasmTypst: http://127.0.0.1:${port}`),
);
