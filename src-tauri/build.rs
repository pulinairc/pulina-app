use std::path::Path;
use std::process::Command;

fn main() {
    // The commit Lobby is built from and its date, shown with the version in Settings.
    let git = |args: &[&str]| {
        Command::new("git")
            .args(args)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    };
    let mut commit = git(&["rev-parse", "--short", "HEAD"]);
    // A CI checkout without git history still knows its commit.
    if commit.is_empty() {
        commit = std::env::var("GITHUB_SHA").map(|s| s.chars().take(7).collect()).unwrap_or_default();
    }
    println!("cargo:rustc-env=LOBBY_COMMIT={commit}");
    println!("cargo:rustc-env=LOBBY_COMMIT_DATE={}", git(&["log", "-1", "--format=%cs"]));
    for path in ["../.git/HEAD", "../.git/refs/heads", "../.git/packed-refs"] {
        if Path::new(path).exists() {
            println!("cargo:rerun-if-changed={path}");
        }
    }
    // The bundle's own icon; a fork such as the Pulina app names its own in this file.
    let default_icon = std::fs::read_to_string("icons/default.txt").expect("icons/default.txt");
    println!("cargo:rustc-env=APP_DEFAULT_ICON={}", default_icon.trim());
    println!("cargo:rerun-if-changed=icons/default.txt");
    tauri_build::build()
}
