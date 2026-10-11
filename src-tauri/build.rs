fn main() {
    // Embed a requireAdministrator manifest: NIC, HKLM and powercfg changes need elevation.
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("app.manifest"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}
