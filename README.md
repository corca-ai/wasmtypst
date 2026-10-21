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
Serve JavaScript with its JavaScript MIME type and `.wasm.gz` as opaque gzip bytes
(without an additional Content-Encoding claiming those bytes are already decoded). Bundlers must preserve the module Worker
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
HTML target as an in-development feature; PDF-only packages may refuse it.

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
