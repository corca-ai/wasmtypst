# Contributing

Use Bun 1.3.14, Node 24+, Rust 1.96.0 and wasm-bindgen-cli 0.2.128.
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
