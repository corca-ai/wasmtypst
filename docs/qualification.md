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
browser export and frame-based source navigation. The initial 0.1.0 qualification did not include a CorTeX integration. An adopting host still owns registry synchronization,
authorization, package caching, editor history, collaboration and renderer
integration. The engine has no hidden application or backend dependency.

## 0.2.0 production integration qualification

The 2026-10-21 follow-up adds atomic replacement snapshots, independent semantic
HTML compilation, a sandboxed HTML adapter, bounded input queues, resolver
supersession/deadlines and latest-only CompilerSession scheduling with worker
cancellation/recovery. Fifteen native integration cases and the real Node/WASM
suite passed, including invalid-snapshot rollback and dependency-resolution
races. The browser proof checks semantic heading/MathML rendering and blocked
source-generated scripts in an opaque-origin iframe in all three engines.

On the same local Node 24.18.0 host, the unchanged 16 MiB binary workload with a
short edited equation document measured compile median 32.34 ms / p95 32.90 ms
before cached per-file SHA-256 identities, and 0.32 ms / 0.54 ms afterward (25
warm samples). Both had a 38,010,880-byte linear-memory high water mark. This is
a targeted fingerprint-cost comparison, not a general 100x compiler claim.
UTF-8 binary assets also no longer build an unused Typst syntax tree on admission.

`bun run benchmark` now uses twelve sections of actual paragraphs, equations and
tables. Twenty warm edits measured paginated p95 2.21 ms and semantic HTML p95
5.52 ms without the binary; the later warmed asset scenario measured 1.08 ms and
1.53 ms. The combined process peak RSS was 439,744 KiB and linear memory ended
at 75,038,720 bytes. RSS includes Node, workers, compiled code, inputs and
transient copies; this is not an isolated compiler heap measurement. Cold Node
initialization was one 80 ms observation. CPU load and cache order affect results.

Browser SVG edit-to-paint p95 was 16.4 / 44.5 / 33.1 ms for Chromium / Firefox /
WebKit; the synthetic large-project results were 17.6 / 52.9 / 33.6 ms. The
optimized HTML-capable module measured 36,857,336 raw bytes and 16,589,150 gzip
bytes. Browser initialization fetches the compressed module; Node can use raw
bytes. The packed consumer checks both assets and the HTML adapter declarations.

A commercial host still needs its own representative document/package corpus,
resource-constrained-device qualification and operating budgets. The engine
provides no hard process memory cap, and Typst's upstream HTML target remains
in development. CorTeX integration is reviewed separately in its own repository.
