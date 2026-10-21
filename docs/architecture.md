# Architecture

WasmTypst embeds the official Typst compiler and IDE libraries at one exact
version, using one memory-backed World per compiler. It is a headless SDK;
browser views and editor providers are optional adapters. It has no dependency
on CorTeX or its application model.

## Engine

Rust owns project files, incremental Source objects, fonts, inputs, compilation,
diagnostics, PDF/SVG export, formatting and source semantics. Typst, typst-ide,
typst-layout, typst-pdf and typst-svg are pinned together in Cargo.toml and
Cargo.lock. Typstyle uses that same typst-syntax version. No Tinymist compiler,
native filesystem, package downloader, native preview server or system fonts
participates.

Every effective mutation increments the engine revision and invalidates export
bytes. Compile reuses Typst's memoization and incrementally reparsed Source
objects; identical puts preserve the revision. Successful output belongs to
one revision. PDF, SVG and both navigation directions reject an older revision
after any mutation. Failed compile replaces the engine's previous successful
document; a host may keep displaying its previous image, but cannot query it
against newer source.

The SHA-256 fingerprint covers the runtime profile and Cargo.lock, main path,
all project/package file bytes, bundled and added fonts, and configuration.
File insertion order does not change identity. Source remains solely in memory.
Dependencies and missing files are conservative session inventories: memoized
Typst queries can reuse earlier reads, so these sets can include previous
dependencies. A successful compile does not need to resolve remaining entries.

## Navigation

The retained PagedDocument is the authority for coordinates. Official
typst-ide maps source cursors to document page points and page clicks to source
spans, internal destinations or URLs. Coordinates use points from the top-left
of a page, page numbers start at one, and public source offsets use UTF-16.
Offsets splitting a surrogate pair are refused. Unmapped positions return
empty results; the SDK does not guess a source range from rendered text.

The SVG Preview displays generated SVG as isolated image URLs and converts
click coordinates using the displayed page rectangle. It neither injects SVG
markup into the host DOM nor activates document links automatically. A PDF
viewer can use the identical point API without any dependency on Preview.

## Language services

Completion, hover and definition call typst-ide against the same World and only
use a compiled document when its revision is current. References compare
resolved definition spans across admitted source files. Rename returns a
revision-bound edit plan, respects lexical shadowing, refuses package edits,
and conservatively rejects names that could collide with existing identifiers.
It supports identifier bindings, including imports; it does not rename labels
or arbitrary textual occurrences. No language query mutates source.

Formatting uses Typstyle and refuses syntactically invalid documents. Tokens
classify the actual syntax tree, rather than applying regexes to source.
Symbols and folding expose source ranges. They are editor-neutral data; the
optional Monaco providers translate offsets and reject cancelled/stale results.
The host synchronizes its authorized file inventory and admits diagnostics at
the current revision. Editor presence, collaboration and undo belong to the host.

## Hosts and lifecycle

The browser entry creates a dedicated module Worker. The Node entry uses
worker_threads with the same generated WASM and JS core. Requests are serialized
inside the worker and correlated by ID. A worker error or request timeout rejects
all pending operations and terminates the worker; reuse requires a new compiler
and the host's current file inventory. Disposal has the same cancellation
semantics. Output buffers transfer back to the host; inputs are cloned so host
edits cannot mutate an in-flight compile.

The direct Core entry has no DOM access and runs synchronously after async
initialization. Its WASM module is shared within a realm; it cannot enforce a
wall-clock deadline on a synchronous compile. Use a worker for untrusted source,
responsive interaction and complete memory reclamation. WASM memory has a high
water mark and does not shrink when an individual Core is freed.

## Assets and limits

Public package/font bytes may be supplied by the host. Missing package paths
use `@namespace/name:version/path`; package manifests, imports and plugin bytes
resolve through the same virtual filesystem. The optional host resolver is
explicit, bounded to 64 resolution rounds, and may refuse any path. It owns
download authorization, request timeouts, integrity checks and persistent caching.
There is no implicit registry or CDN fallback inside the SDK.

The engine admits at most 4096 files, 16 MiB per file, 64 MiB total file bytes,
and 256 font faces within 64 MiB of font bytes. These are admission limits,
not an execution-memory sandbox.
The worker deadline bounds a stuck request; it does not impose a process-memory
limit. No source is written to browser storage or uploaded by the SDK.

## Build and qualification

Rust, wasm-bindgen and Binaryen are pinned. Release builds optimize the WASM,
emit strict TypeScript declarations, copy upstream notices and record engine
size, digest and lockfile provenance in dist/build.json. The same artifact runs
the Node, browser and packed-package tests. Byte-identical builds across host
platforms are not promised.

The browser proof covers five bidirectional navigation cases, actual SVG image
paint, eight language capabilities, a package WASM plugin, revision refusal,
and a synthetic 100-source-file project exceeding 1 MiB. Warm measurements
discard setup and record 20 samples. Cold startup is a single observation per
browser, not a p95 claim. Linear-memory size is supplementary and excludes host
allocations. These tests do not establish compatibility with every package,
font, PDF viewer, document or resource-constrained device.
