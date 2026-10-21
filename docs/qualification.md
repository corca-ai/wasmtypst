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

The final source-cache regression also verifies references and rename across an
imported `.txt` source, including after atomic replacement. On-demand source
cells retain those syntax trees once used, while untouched UTF-8 assets remain
unparsed. The native suite now contains sixteen integration cases.

## 0.3.0 visual editing foundation

The syntax-only module measured 290,589 raw bytes. A local 25-sample Node run
parsed 11,600 UTF-16 units of actual headings, prose, emphasis and equations at
2.07 ms median / 3.99 ms p95. This is a parser benchmark, not editor latency or
a large-document guarantee. Native tests cover UTF-16 including astral text and
CRLF, malformed syntax, decoded escapes, node/input limits and subsequent use.
The packed consumer imports the actual syntax module and its public declarations.
All three browser engines run the real syntax grammar. Compiler tests check
opt-in MathML fragments against their actual equation source ranges and cache
invalidation; hosts still own sanitization, source admission and editing.

## Representative corpus and locked resource delivery

The 2026-10-21 follow-up adds an optional host-side `wasmtypst/resources`
adapter and a repeatable corpus gate, without adding network access or fonts to
the engine. The loader tests cover exact-path admission, HTTPS/credential/redirect
policy, frozen lock configuration, streamed size bounds, SHA-256 verification,
cache corruption, buffer isolation, offline refusal, deadlines and cancellation
before and during response consumption. An additional local real-HTTPS probe
fetched the pinned charged-ieee manifest and source through the default fetch
implementation and verified their exact locked sizes and digests. CI remains
offline for corpus dependencies and does not depend on third-party availability.

`CORPUS_SAMPLES=25 bun run test:corpus` passed all five fixtures in Node 24.18.0,
Chromium, Firefox and WebKit. The same fixtures also passed a narrow-viewport
Chromium host with 4x page CPU throttling. Page throttling does not certify
compiler Worker CPU throttling or a physical resource-constrained device.
Every runtime produced byte-identical PDFs for each fixture. Paginated output
had no missing-font/glyph warnings; the real IEEE template produced two pages,
and the synthetic long document produced 24 pages.

All five fixtures compiled as HTML too. This is not visual equivalence to PDF:
charged-ieee emits native warnings that its page rules and placement are ignored
in HTML. Those diagnostics are retained in the raw report. The CJK font subset
only proves the characters in the fixture. The corpus does not yet span many
publication templates or certify arbitrary CJK documents.

| Runtime | 24-page warm compile p95 (25 edits) |
| --- | ---: |
| Node | 2.11 ms |
| Chromium | 1.88 ms |
| Firefox | 10.10 ms |
| WebKit | 2.32 ms |

These are local desktop compile timings, excluding image decode, paint and
PDF export. Each runtime reuses one compiler across the fixed corpus order;
initial setup and first compilation are recorded separately. Peak observed
WASM linear memory after the 25-edit corpus was approximately 50.6 MiB in all
runtimes. The gate enforces a 96 MiB corpus high-water budget, distinct from
the runtime's 256 MiB maximum. Neither figure bounds browser process memory.
Raw build provenance, per-case samples, diagnostics and memory live in ignored
`report/corpus.json` (the local 25-sample record is also retained as
`report/corpus-25-samples.json`); CI uploads its own record with qualification
artifacts. No compiler speedup, smaller runtime or physical-mobile qualification
is claimed by this change.

## Expanded corpus: external examples and explicit failures

The next PR #3 revision expands the gate to 18 cases, rather than treating
compilation success on a handful of short examples as broad compatibility.
The 12 successful documents include four new authored edge-case documents,
unmodified Elsevier and mathematical-paper templates, and a separately adapted
seven-page finite-volume tutorial. Source commits, licenses, byte lengths and
SHA-256 are checked before execution. Poppler extracts expected text (including
CJK), rasterizes first/last pages, and exports local PDF/HTML/text/PNG evidence.
Representative rasterized pages were visually inspected locally.

The other six cases are explicit contracts, not successful-document claims:

- Springer 0.1.0 fails in ctheorems 1.1.2 on `state.display()`; original
  LaPreprint fails on the obsolete `locate(callback)` form. Official native
  Typst 0.15.1 reproduces both errors, so these are upstream version
  incompatibilities. The originals are preserved; unrelated diagnostics fail
  the gate.
- The API-adapted finite-volume source with full-resolution original images
  lays out seven pages but traps at WASM PDF export. Images represent about
  185 MiB as RGBA; a focused direct-engine probe observed 231,669,760 bytes
  before export and 265,879,552 bytes after the trap, near the fixed 256 MiB
  maximum. The official native CLI exports this same source/assets successfully.
  This is a real SDK resource limitation. The gate checks the observed failure
  and a successful fresh-Worker recovery; no heap cap was raised.
- Invalid syntax, an unapproved package and malformed bibliography must each
  produce the specified diagnostics, then accept a valid replacement snapshot
  and export PDF in that same Worker.

Layout HTML may omit entire columns and grids, not merely change their
appearance. The authored layout case records the exact native warnings and
missing grid text; its PDF must retain that text. Elsevier also retains its
explicit unknown XITS/STIX font warnings while using bundled fallback fonts.
The browser-sized tutorial is a separate adaptation: old APIs are shimmed and
figures explicitly resampled to at most 1200 pixels, with provenance and
CC BY-SA attribution retained. It is not proof that original full-resolution
exports work.

A 25-edit run passed the 18 contracts in Node, all three browser engines and
the extra Chromium host. Successful PDF bytes matched across runtimes.
Extended cases use one Worker per project, disposed on project close; edits
reuse that project's World. The original five cases still share one World.
The maximum observed successful-project linear-memory high water was about
76.7 MiB, below the unchanged 96 MiB gate. A separate diagnostic run retaining
all unrelated extended projects in one Worker reached about 107.9 MiB; this
is why the project lifecycle and measurement scope are explicit. This revision
does not reduce the compiler's memory use or certify arbitrary project histories.

For the adapted seven-page tutorial, local 25-edit warm compile p95 was
4.79 ms in Node, 4.77 ms in Chromium, 18.90 ms in Firefox and 9.70 ms in WebKit.
These measurements exclude export and paint. Raw records are retained as
`report/corpus-expanded-25-samples.json`, with independent native results in
`report/native-corpus.json`. CI runs its own 18-case qualification and seven
upstream native comparisons using the official 0.15.1 release archive pinned
by SHA-256. Package/font bytes remain test-only and are not added to the compiler
runtime or its download.
