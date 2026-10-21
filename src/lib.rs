mod engine;
mod html_source;
mod ide;
mod wasm;
pub mod world;
pub use engine::Engine;

/// Compiler linear-memory ceiling, shared by the linker and runtime metadata.
pub const WASM_MEMORY_LIMIT_BYTES: u32 =
    include!(concat!(env!("OUT_DIR"), "/wasm_memory_limit.rs"));
