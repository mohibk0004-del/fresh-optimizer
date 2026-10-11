//! Compresses the release FreshOptimizer binary into the setup executable.
//! Build the app first: `npx tauri build --no-bundle` in the repo root.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

fn main() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let app_exe = root.join("src-tauri/target/release/freshoptimizer.exe");
    println!("cargo:rerun-if-changed={}", app_exe.display());
    let bytes = fs::read(&app_exe).unwrap_or_else(|_| {
        panic!("missing {} - run `npx tauri build --no-bundle` first", app_exe.display())
    });

    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let mut enc = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    enc.write_all(&bytes).unwrap();
    fs::write(out.join("payload.bin"), enc.finish().unwrap()).unwrap();

    let conf: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(root.join("src-tauri/tauri.conf.json")).unwrap()).unwrap();
    println!("cargo:rerun-if-changed=../src-tauri/tauri.conf.json");
    println!("cargo:rustc-env=FO_APP_VERSION={}", conf["version"].as_str().unwrap());
    println!("cargo:rustc-env=FO_PAYLOAD_SIZE={}", bytes.len());

    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("app.manifest"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("tauri-build failed");
}
