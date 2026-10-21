# WasmTypst

WasmTypst is a host-independent Typst compiler and language SDK. Read README.md
and docs/architecture.md before changing public behavior.

- Keep one exact Typst version and one World for compile, IDE and navigation.
- Rust owns typesetting and source semantics; JS owns workers and optional UI.
- No filesystem, network, browser storage, application schemas or system fonts
  inside the engine. Hosts supply authorized package, font and project bytes.
- Every output and source map belongs to one revision. Reject stale navigation.
- Keep headless imports free of DOM access and editor/viewer dependencies.
- Use Bun for JS development and gates. Pin Rust and wasm-bindgen versions.
- Verify behavior with real Rust/WASM and the three browser engines. Report
  unverified limits accurately; never replace a missing capability with a stub.
