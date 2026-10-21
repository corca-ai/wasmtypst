use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=WASMTYPST_MEMORY_LIMIT_MIB");
    println!("cargo:rerun-if-changed=build.rs");
    let mib = env::var("WASMTYPST_MEMORY_LIMIT_MIB").unwrap_or_else(|_| "512".into());
    let mib: u32 = mib
        .parse()
        .expect("WASMTYPST_MEMORY_LIMIT_MIB must be 256, 512 or 1024");
    assert!(
        [256, 512, 1024].contains(&mib),
        "WASMTYPST_MEMORY_LIMIT_MIB must be 256, 512 or 1024"
    );
    let bytes = mib * 1024 * 1024;
    fs::write(
        PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("wasm_memory_limit.rs"),
        format!("{bytes}u32"),
    )
    .unwrap();
    if env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        println!("cargo:rustc-link-arg=--max-memory={bytes}");
    }
}
