# Contributing

Use Bun 1.4.4, Node 24+, Rust 1.96.0 and wasm-bindgen-cli 0.2.128.
Read AGENTS.md and docs/architecture.md. Run `bun install --frozen-lockfile`,
`bun run build`, `bunx playwright install chromium firefox webkit` and
`bun run check` before submitting a pull request. `bun run benchmark` records
real document edit latency and the process RSS high water mark in `report/`.

Keep the compiler independent of any host application. Add real engine coverage
for changes to output, revisions, navigation, package resolution or lifecycle.
Source and binaries in bug reports must be redistributable; reduce private
project documents before sharing them.

CI builds the WASM from the pinned source, tests all three browser engines and
an isolated package consumer, and uploads the package, checksums and provenance.
A passing CI artifact is a candidate, not an automatic public release. Published
release assets must be immutable; fix an artifact under a new version.

Document corpus gates also require Poppler (`pdftotext`, `pdftoppm`; install
`poppler-utils` on Ubuntu or `poppler` on macOS). They export PDFs, extract
expected text and rasterize the first/last pages into ignored `report/corpus/`.
`CORPUS_SAMPLES=25 bun run test:corpus` runs the longer edit workload.

For independent upstream qualification, obtain the official Typst 0.15.1 CLI
and run `TYPST_NATIVE_BIN=/absolute/path/to/typst bun run test:corpus:native`.
CI runs this separately with a SHA-256-pinned Linux release archive. It confirms
which original templates also fail natively and that the full-resolution
image document also exports natively. Keep upstream source
and asset hashes in `tests/fixtures/corpus/upstream.json`; preserve originals
and document adaptations separately instead of silently patching vendor files.

The compiler defaults to a 512 MiB WASM linear-memory ceiling. Override it with
`WASMTYPST_MEMORY_LIMIT_MIB=256|512|1024` for `bun run build`; the independent
syntax parser stays at 256 MiB. This controls WASM growth, not total process
memory. Build receipts and runtime stats report the compiled value.

To repeat the memory experiment, build the default SDK first, then run
`bun run build:memory-profiles` and `bun run benchmark:memory`. The first command
backs up/restores the complete default SDK around two additional optimized
builds. Comparison assets are ignored under `tests/fixtures/.memory-profiles/`
and are never packaged into the runtime. The second command uses real Node
processes (not Bun's Node-compatible mode), validates actual memory growth
ceilings, runs three independent Node samples per profile and exercises all
three browsers. CI runs the comparison and uploads its receipts/measurements.
