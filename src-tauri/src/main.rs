#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsString;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};

fn sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("sidecar").join("optimizer.js"));
    }

    if let Ok(exe_dir) = std::env::current_exe().and_then(|p| {
        p.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "No executable parent"))
    }) {
        candidates.push(exe_dir.join("sidecar").join("optimizer.js"));
        candidates.push(exe_dir.join("..").join("sidecar").join("optimizer.js"));
        candidates.push(exe_dir.join("..").join("..").join("sidecar").join("optimizer.js"));
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("sidecar").join("optimizer.js"));
        candidates.push(cwd.join("..").join("sidecar").join("optimizer.js"));
    }

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "Could not locate sidecar/optimizer.js".to_string())
}

fn node_command() -> Result<OsString, String> {
    if let Ok(node) = std::env::var("NODE") {
        return Ok(OsString::from(node));
    }

    for candidate in ["node", "node.exe"] {
        if Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
        {
            return Ok(OsString::from(candidate));
        }
    }

    Err("Node.js executable not found in PATH".to_string())
}

fn run_sidecar(app: AppHandle, args: Vec<String>) -> Result<(), String> {
    let script = sidecar_path(&app)?;
    let node = node_command()?;
    let mut child = Command::new(node)
        .arg(&script)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start optimizer: {}", e))?;

    let stdout = child.stdout.take().ok_or("No stdout")?;
    let stderr = child.stderr.take().ok_or("No stderr")?;

    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|e| e.to_string())?;
        if !line.trim().is_empty() {
            app.emit("optimizer_event", line).ok();
        }
    }

    let stderr_output = std::thread::spawn(move || -> Result<String, String> {
        let mut collected = Vec::new();
        for line in BufReader::new(stderr).lines() {
            let line = line.map_err(|e| e.to_string())?;
            if !line.trim().is_empty() {
                collected.push(line);
            }
        }
        Ok(collected.join("\n"))
    });

    let status = child.wait().map_err(|e| e.to_string())?;
    let stderr_output = stderr_output
        .join()
        .map_err(|_| "Failed to join stderr reader".to_string())??;

    if !status.success() {
        let details = if stderr_output.trim().is_empty() {
            format!("Optimizer exited with status {}", status)
        } else {
            stderr_output
        };
        return Err(details);
    }

    Ok(())
}

#[tauri::command]
async fn open_zip_dialog(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_title("Select site ZIP archive")
        .add_filter("ZIP Archive", &["zip"])
        .blocking_pick_file()
        .map(|p| p.to_string())
}

#[tauri::command]
async fn open_folder_dialog(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_title("Select site folder")
        .blocking_pick_folder()
        .map(|p| p.to_string())
}

#[tauri::command]
async fn unzip_site(app: AppHandle, zip_path: String) -> Result<String, String> {
    let zip = Path::new(&zip_path);
    let stem = zip.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let parent = zip.parent().unwrap_or(Path::new("."));
    let work_dir = parent.join(format!("{}_optimizer_work", stem))
        .to_string_lossy().to_string();
    let _ = std::fs::remove_dir_all(&work_dir);
    let wd = work_dir.clone();
    let app2 = app.clone();
    tokio::task::spawn_blocking(move || {
        run_sidecar(app2, vec!["unzip".into(), zip_path, wd])
    }).await.map_err(|e| e.to_string())??;
    Ok(work_dir)
}

#[tauri::command]
async fn prepare_folder(app: AppHandle, folder_path: String) -> Result<String, String> {
    let src = Path::new(&folder_path);
    let name = src.file_name().unwrap_or_default().to_string_lossy().to_string();
    let parent = src.parent().unwrap_or(Path::new("."));
    let work_dir = parent.join(format!("{}_optimizer_work", name))
        .to_string_lossy().to_string();

    let _ = std::fs::remove_dir_all(&work_dir);
    copy_dir_all(src, Path::new(&work_dir))
        .map_err(|e| format!("Failed to copy folder: {}", e))?;

    let _ = app.emit("optimizer_event",
        r#"{"type":"status","message":"Folder copied to work directory…"}"#);
    Ok(work_dir)
}

fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if ["node_modules", ".git", ".trash"].contains(&name.to_string_lossy().as_ref()) {
            continue;
        }
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(&name))?;
        } else {
            std::fs::copy(entry.path(), dst.join(&name))?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn optimize_site(app: AppHandle, work_dir: String) -> Result<(), String> {
    let wd = work_dir.clone();
    tokio::task::spawn_blocking(move || {
        run_sidecar(app, vec!["optimize".into(), wd])
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn export_as_zip(app: AppHandle, work_dir: String, original_path: String) -> Result<String, String> {
    let orig = Path::new(&original_path);
    let stem = orig.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let parent = orig.parent().unwrap_or(Path::new("."));
    let out_zip = parent.join(format!("{}_optimized.zip", stem))
        .to_string_lossy().to_string();
    let oz = out_zip.clone();
    tokio::task::spawn_blocking(move || {
        run_sidecar(app, vec!["rezip".into(), work_dir, oz])
    }).await.map_err(|e| e.to_string())??;
    Ok(out_zip)
}

#[tauri::command]
async fn export_as_folder(app: AppHandle, work_dir: String, original_path: String) -> Result<String, String> {
    let orig = Path::new(&original_path);
    let name = orig.file_stem()
        .or_else(|| orig.file_name())
        .unwrap_or_default()
        .to_string_lossy().to_string();
    let parent = orig.parent().unwrap_or(Path::new("."));
    let out_dir = parent.join(format!("{}_optimized", name))
        .to_string_lossy().to_string();
    let _ = std::fs::remove_dir_all(&out_dir);
    let od = out_dir.clone();
    tokio::task::spawn_blocking(move || {
        run_sidecar(app, vec!["copyout".into(), work_dir, od])
    }).await.map_err(|e| e.to_string())??;
    Ok(out_dir)
}

#[tauri::command]
async fn cleanup_work_dir(work_dir: String) -> Result<(), String> {
    std::fs::remove_dir_all(&work_dir).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            open_zip_dialog,
            open_folder_dialog,
            unzip_site,
            prepare_folder,
            optimize_site,
            export_as_zip,
            export_as_folder,
            cleanup_work_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
