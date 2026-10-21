# WasmTypst

[![Check](https://github.com/corca-ai/wasmtypst/actions/workflows/ci.yml/badge.svg)](https://github.com/corca-ai/wasmtypst/actions/workflows/ci.yml)

A Typst compiler and language SDK for browsers and Node. One Rust/WASM runtime
owns compilation, PDF/SVG and semantic HTML output, diagnostics, editor queries and bidirectional
source navigation against the same document revision.

## Package entries

The SDK has no runtime JavaScript dependencies. Editor and view adapters are
optional; the integrating application owns source, collaboration and history.

| Entry | Purpose |
| --- | --- |
| `wasmtypst` | Browser Worker compiler and public types |
| `wasmtypst/node` | Node Worker compiler, same WASM engine |
| `wasmtypst/core` | Direct headless engine, browser or Node |
| `wasmtypst/preview` | Optional SVG image preview with click navigation |
| `wasmtypst/html-preview` | Scriptless sandboxed semantic HTML view |
| `wasmtypst/monaco` | Optional Monaco language providers and diagnostics adapter |
| `wasmtypst/wasm` | Released WASM asset |
| `wasmtypst/syntax` | Small synchronous official parser after async initialization |
| `wasmtypst/syntax-wasm` | Syntax-only WASM asset |
| `wasmtypst/resources` | Optional host-side integrity-locked resource delivery |

```ts
import { createCompiler } from 'wasmtypst';
// On Node, import createCompiler from 'wasmtypst/node' instead.

const compiler = await createCompiler({
  files: { 'main.typ': '= Hello\nA document with $x^2$.' },
});
try {
  const result = await compiler.compile();
  if (result.success) {
    const pdf = await compiler.pdf(result.revision); // Uint8Array
    const svg = await compiler.svg(result.revision, 1);
    const positions = await compiler.sourceToOutput(result.revision, 'main.typ', 2);
    console.log(pdf, svg, positions);
  } else {
    console.error(result.diagnostics);
  }
} finally {
  compiler.dispose();
}
```

The Worker and compressed WASM assets resolve relative to the installed package.
Serve JavaScript with its JavaScript MIME type. The loader accepts both opaque
`.wasm.gz` bytes and hosts that transparently decode them through Content-Encoding. Bundlers must preserve the module Worker
and generated wasm-bindgen module/assets. A host may set `wasm` to an immutable
URL, byte buffer or compiled WebAssembly.Module. Cross-origin isolation and
SharedArrayBuffer are not required.

## Editing and language features

Supply project text and binaries with `putFile`, remove them with `removeFile`,
and choose the entry with `setEntry`. `addFont` admits project font bytes;
standard fonts are bundled. `configure` accepts string-valued `sys.inputs` and
an optional explicit `[year, month, day]`. There is no implicit system clock.

```ts
await compiler.putFile('main.typ', '#let answer=42\n#answer');
const hover = await compiler.hover('main.typ', 19);
const completion = await compiler.completion('main.typ', 19);
const definition = await compiler.definition('main.typ', 19);
const references = await compiler.references('main.typ', 19);
const rename = await compiler.rename('main.typ', 19, 'result');
const formatting = await compiler.format('main.typ');
const tokens = await compiler.semanticTokens('main.typ');
```

All offsets are UTF-16 code units. Rename and formatting return source edits;
the host applies them to its shared text and sends the resulting file back.
Only apply an edit plan while its revision matches your admitted document.
PDF, SVG and navigation require the exact successful compile revision and
refuse stale output after any effective file, entry, font or configuration edit.

`outputToSource(revision, {page, x, y})` accepts page points and returns a source
location, an internal point, a URL, or null. Pages are numbered from one; page
coordinates use typographic points from the top-left. Non-text source cursors
may have no rendered position. Symbols and folding ranges are also available.

## Packages and privacy

The engine has no filesystem or network fallback. Hosts explicitly supply
authorized package files, images, bibliographies, fonts and WASM plugins.
Package keys are `@preview/package:version/file`, including typst.toml.

```ts
const compiler = await createCompiler({
  files: { 'main.typ': '#import "@local/example:0.1.0"\n#example.greeting' },
  async resolveFile(path) {
    // Your allowlist, verified package archive or project registry.
    // Return string/Uint8Array, or null to refuse. No source is uploaded.
    return authorizedFiles.get(path) ?? null;
  },
});
```

The SDK uses memory only. It does not persist project source or download
arbitrary packages. `CompileResult.fingerprint` hashes the runtime profile,
source/dependency/font bytes and configuration. `dependencies` and
`missingFiles` are conservative session inventories, not exact dependency graphs.

## Preview and editor adapters

The optional Preview renders isolated SVG images. Listen for `navigate` events
to select source, handle internal destinations or decide whether to open a URL.
The host supplies the preview's accessible container name. Default page image
labels are English; a custom view may provide localized labels.

```ts
import { Preview } from 'wasmtypst/preview';
const preview = new Preview(element, compiler);
preview.addEventListener('navigate', event => console.log(event.detail));
await preview.render(await compiler.compile());
// On unmount: preview.dispose(); compiler.dispose();
```

`registerMonaco(monaco, compiler, {pathForUri, uriForPath})` registers Typst
providers without importing Monaco at runtime. Keep the compiler's file
inventory synchronized before queries. The adapter requires affected rename
models to be open; the core edit plan also supports unopened files. Call
`publishDiagnostics` only for a result admitted at the current revision.

## Development

Install Rust 1.96.0, wasm-bindgen-cli 0.2.128 and Bun 1.3.14. The Rust toolchain
file includes the WASM target. Tests use Node 24+ and Playwright's three engines.

```sh
bun install --frozen-lockfile
cargo install wasm-bindgen-cli --version 0.2.128 --locked
bun run build
bunx playwright install chromium firefox webkit
bun run check
bun run serve # http://127.0.0.1:8788
```

Release builds run pinned Binaryen optimization. For local development only,
`bun run scripts/build.mjs --skip-opt` emits an explicitly unoptimized receipt.
Generated browser measurements remain in ignored `report/`. The package test
packs the actual artifact and verifies it in an isolated consumer.

See [architecture and limits](docs/architecture.md) for revision ownership,
language coverage, host resolution, disposal and qualification boundaries.
Original code is MIT licensed. Typst, fonts and other dependencies retain their
licenses; see THIRD_PARTY_NOTICES.md and LICENSES included with the build.

## HTML and consistent project replacement

```ts
await compiler.snapshot({
  entry: 'main.typ',
  files: { 'main.typ': '= Article\nA *semantic* document with $x^2$.' },
});
const html = await compiler.compileHtml();
if (html.success) console.log(html.html);
```

Snapshots atomically replace the inventory, including deletions, in one revision.
Invalid snapshots leave the current world and output intact. The caller owns the
source snapshot; concurrent host mutations supersede a compile or dependency
resolution rather than admitting mixed results. HTML has its own target
diagnostics and does not require paginated layout. Typst 0.15.1 still marks its
HTML target as an in-development feature; PDF-only packages may refuse it. Use `html.frame` for layout-based diagrams
that must remain graphical in HTML; the interactive example shows a
`context target()` rule that also preserves paginated output.

```ts
import { HtmlPreview } from 'wasmtypst/html-preview';
const view = new HtmlPreview(element, { title: 'Document preview' });
view.render(await compiler.compileHtml());
// On unmount: view.dispose();
```

HTML retains headings, selectable text, tables and MathML. The optional view
does not grant source-generated HTML scripts, origin access, forms or network
resources. Raw HTML export is not sanitized for insertion in a trusted host DOM.

Repository: [corca-ai/wasmtypst](https://github.com/corca-ai/wasmtypst).
See [contributing](CONTRIBUTING.md) for qualification and release artifacts.

For interactive hosts, `CompilerSession` coalesces work and supports cancellation:

```ts
import { CompilerSession, createCompiler } from 'wasmtypst';
const session = new CompilerSession(() => createCompiler());
const result = await session.compile(snapshot, { target: 'html', signal });
// Superseded requests reject with AbortError. Dispose on project close.
session.dispose();
```

`bun run benchmark` measures a multi-section article with paragraphs, equations
and tables, with and without a 16 MiB binary. It reports warm percentiles, cold
initialization, linear memory and process peak RSS separately.

## Source-preserving visual editors

```ts
import { createSyntaxParser } from 'wasmtypst/syntax';
const parser = await createSyntaxParser();
const tree = parser.parse('= Heading\nA *strong* _emphasized_ document.');
// Every node: kind, UTF-16 from/to, children, and optional decoded value/block.
```

The syntax entry loads a separate 291 kB raw parser built from exactly the
compiler's Typst 0.15.1 grammar. It includes no fonts, layout engine, World or
compiler. Parsing is synchronous and stateless after initialization; the host
owns its projection, edits and collaboration. Unknown syntax kinds must remain
source in a visual editor. Input is bounded to 8,000,000 UTF-8 bytes; serialization
refuses trees exceeding 262,144 nodes or depth 256. These are admission limits,
not a whole-process memory or main-thread latency guarantee. Node callers supply
bytes from `wasmtypst/syntax-wasm` explicitly.

`compiler.compileHtml({ math: true })` returns `math` entries with source
locations and native MathML from the same compiled document and revision.
No second equation compiler guesses source context. The default leaves `math`
empty and avoids fragment extraction. Fragment HTML remains untrusted; isolate
it or sanitize with a restrictive MathML policy before placing it in a host DOM.

## Locked package and font delivery

`wasmtypst/resources` is an optional **host-side** adapter. Give it an explicitly
approved inventory of exact file URLs, SHA-256 digests and decoded byte lengths:

```ts
import { createResourceLoader } from 'wasmtypst/resources';
const resources = createResourceLoader({
  resources: approvedLock.resources,
  cache: authorizedCache, // optional host-owned get/put; receives AbortSignal
});
const compiler = await createCompiler({ resolveFile: resources.resolveFile });
const font = await resources.resolveFile('fonts/Project-Regular.otf');
if (font) await compiler.addFont(font);
```

List each package's `typst.toml`, entrypoint, transitive imports and plugin bytes
under its exact `@namespace/name:version/path`; archives are not extracted by
this adapter. Font resources are explicit too; it never queries system fonts.
Lock files and URLs are trusted application configuration, not document input.
Approve the package version, distribution license and complete file inventory
before creating a lock. The loader does not discover or approve dependencies.

Unknown paths return null without I/O. Downloads use HTTPS without credentials,
referrers or redirects, a 15-second default deadline and a bounded streaming
read (16 MiB default per resource, configurable up to 64 MiB). Sizes describe
**decoded** bytes. Both downloaded and cached bytes must match the lock's size
and SHA-256 before use. Cache contents and returned buffers are isolated.
Cache implementations own persistence, eviction, authorization and cancellation;
cache errors and corruption are reported rather than silently ignored.
`offline: true` permits only verified cache hits and makes no network requests.
No network, persistence or cache is added to the compiler engine or core import.

## Representative document qualification

`bun run test:corpus` runs the same five documents in Node, Chromium, Firefox
and WebKit: a multi-file research article with bibliography and SVG, the
unmodified charged-ieee 0.1.4 template, Korean/Japanese/Chinese text using a
project font, cmarker 0.1.8 with its real WASM plugin, and a synthetic 24-chapter
research document. Locked dependencies are preloaded into an offline cache.
It checks page counts, byte-identical PDF output across runtimes, real PDF/SVG
export, semantic HTML,
incremental edits, stale-output refusal and missing-font/glyph diagnostics.
Provenance and font licenses live in `tests/fixtures/README.md`.

The raw `report/corpus.json` records engine/build identity, browser versions,
initialization time, per-document first/warm compile times, diagnostics and WASM
linear-memory high water marks. `CORPUS_SAMPLES=25 bun run test:corpus` collects
more editing samples. A fourth browser pass uses a narrow mobile viewport and
4x **page** CPU throttling; this does not establish throttling of the compiler
Worker or the behavior of a physical mobile device. The corpus enforces a 96 MiB
WASM linear-memory budget, separately from the engine's 256 MiB maximum.
Times are observations, not portable latency guarantees.
These desktop browsers do not certify mobile devices or arbitrary templates.
