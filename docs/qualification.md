# SDK qualification

The 2026-10-21 local qualification ran the optimized 0.1.0 SDK using Typst
0.15.1, Rust 1.96.0, wasm-bindgen 0.2.128 and Playwright 1.59.1. Generated
receipts and raw results remain in dist/build.json and ignored report/.
The [architecture](architecture.md) defines the implemented contracts and limits.

## Functional verification

All 13 Rust integration tests, strict TypeScript checks, Clippy and Node SDK
tests passed. The actual packed package compiled a document in an isolated Node
consumer and typechecked every public entry under strict NodeNext resolution.
The package retains its third-party license texts and bundled font notices.

Chromium 147.0.7727.15, Firefox 148.0.2 and WebKit 26.4 all passed:

- PDF and SVG compilation, image paint and preview click navigation.
- Bidirectional navigation for prose, math, figure, table and nested content.
- Completion, hover, definition, references, rename, formatting, syntax tokens
  and source-matching diagnostics.
- Package manifest/import resolution and an actual cmarker WASM plugin.
- Adding project-local Roboto font bytes and compiling without missing-font
  diagnostics.
- Refusing export against a stale revision after a source change.
- A synthetic 100-source-file project exceeding 1 MiB.
- One compiler WASM request, local GETs only, and no persistent source storage.

The Node and all three browser engines produced byte-identical PDFs for the
shared navigation fixture. The interactive demo was inspected in a real browser
with readable text, mathematics, a figure and a table. Poppler independently
parsed and rendered the exported A4 PDF, retaining its tagged structure.

## Observed performance

Each warm measurement discards setup and collects 20 samples. Editing changes
visible source and waits for SVG image decode and two animation frames.
The fixture uses short academic constructs; the large fixture's bulk is
deterministic comments. These are bounded synthetic workloads, not a survey of
arbitrary research projects or publication templates.

| Browser | Compile p95 | Edit-to-paint p95 | PDF export p95 | Large edit-to-paint p95 |
| --- | ---: | ---: | ---: | ---: |
| Chromium | 0.85 ms | 16.5 ms | 0.76 ms | 16.9 ms |
| Firefox | 2.64 ms | 34.7 ms | 2.54 ms | 84.1 ms |
| WebKit | 2.30 ms | 33.1 ms | 1.72 ms | 34.8 ms |

Cold startup observations were approximately 806, 507 and 191 ms respectively.
Each is one fresh-context observation, not cold p95. Animation scheduling and
local CPU load affect paint measurements; the harness observes image readiness
and animation frames rather than hardware display presentation.

The optimized runtime is 36,659,987 bytes, or 16,534,310 bytes with gzip level 9.
This includes bundled standard fonts and the compiler, IDE, PDF and SVG code.
Post-workload WASM linear memory was 30,932,992 bytes in each engine. This is
neither process memory nor credible peak-memory qualification for the old CorTeX
Phase 0 gate. No mobile, browser-relative ratio or arbitrary-corpus certification
is claimed.

## Adoption boundary

The SDK removes the measured two-runtime/version mismatch and supplies actual
browser export and frame-based source navigation. CorTeX integration has not
been implemented. An adopting host still owns registry synchronization,
authorization, package caching, editor history, collaboration and renderer
integration. The engine has no hidden application or backend dependency.
