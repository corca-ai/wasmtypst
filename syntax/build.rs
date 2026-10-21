fn main() {
    // The syntax-only parser keeps a separate ceiling from the compiler profile.
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        println!("cargo:rustc-link-arg=--max-memory=268435456");
    }
}
