#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsString;
use std::io::{BufRead, BufReader};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};
use tauri_plugin_updater::{Update, UpdaterExt};
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

#[derive(Default)]
struct AppState {
    allow_exit: AtomicBool,
    current_pid: AtomicU32,
}

#[derive(Default)]
struct UpdateState {
    pending: Mutex<Option<Update>>,
}

#[derive(Clone, serde::Serialize)]
struct LaunchPayload {
    mode: String,
    paths: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
struct UpdatePayload {
    current_version: String,
    version: String,
    notes: Option<String>,
    pub_date: Option<String>,
}

#[derive(Clone, serde::Serialize)]
struct UpdateProgressPayload {
    state: String,
    downloaded: u64,
    total: Option<u64>,
    bytes_per_second: f64,
    eta_seconds: Option<u64>,
    message: String,
}

#[derive(Clone, serde::Serialize)]
struct ContextMenuSettings {
    normal: bool,
    quick: bool,
}

fn normalize_path_for_node(path: &Path) -> OsString {
    let path_str = path.to_string_lossy();
    let normalized = path_str.strip_prefix(r"\\?\").unwrap_or(&path_str);
    OsString::from(normalized)
}

fn sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("optimizer.js"));
        candidates.push(resource_dir.join("sidecar").join("optimizer.js"));
        candidates.push(resource_dir.join("_up_").join("sidecar").join("optimizer.js"));
        candidates.push(resource_dir.join("resources").join("optimizer.js"));
        candidates.push(resource_dir.join("resources").join("sidecar").join("optimizer.js"));
    }

    if let Ok(exe_dir) = std::env::current_exe().and_then(|p| {
        p.parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "No executable parent"))
    }) {
        candidates.push(exe_dir.join("sidecar").join("optimizer.js"));
        candidates.push(exe_dir.join("_up_").join("sidecar").join("optimizer.js"));
        candidates.push(exe_dir.join("..").join("sidecar").join("optimizer.js"));
        candidates.push(exe_dir.join("..").join("_up_").join("sidecar").join("optimizer.js"));
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
        let node_path = PathBuf::from(&node);
        let is_exe = node_path.is_file()
            && node_path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("exe"))
                .unwrap_or(false);
        if is_exe {
            return Ok(OsString::from(node));
        }
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

fn show_main_window_impl(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

fn registry_shell_root(root: &str) -> Result<RegKey, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.create_subkey(root)
        .map(|(key, _)| key)
        .map_err(|e| e.to_string())
}

fn current_exe_command() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(format!("\"{}\"", exe.display()))
}

fn register_context_menu_entry(root: &str, subkey: &str, title: &str, command: &str) -> Result<(), String> {
    let shell_root = registry_shell_root(root)?;
    let (verb_key, _) = shell_root.create_subkey(subkey).map_err(|e| e.to_string())?;
    verb_key.set_value("", &title).map_err(|e| e.to_string())?;
    verb_key
        .set_value("Icon", &std::env::current_exe().map_err(|e| e.to_string())?.display().to_string())
        .map_err(|e| e.to_string())?;
    verb_key
        .set_value("MultiSelectModel", &"Player")
        .map_err(|e| e.to_string())?;
    let (command_key, _) = verb_key.create_subkey("command").map_err(|e| e.to_string())?;
    command_key.set_value("", &command).map_err(|e| e.to_string())
}

fn unregister_context_menu_entry(root: &str, subkey: &str) {
    if let Ok(shell_root) = registry_shell_root(root) {
        let _ = shell_root.delete_subkey_all(subkey);
    }
}

fn apply_context_menu_settings(normal: bool, quick: bool) -> Result<(), String> {
    let exe = current_exe_command()?;
    let roots = [
        "Software\\Classes\\SystemFileAssociations\\.zip\\shell",
        "Software\\Classes\\Directory\\shell",
    ];

    for root in roots {
        if normal {
            register_context_menu_entry(
                root,
                "SiteOptimizer",
                "\u{41e}\u{43f}\u{442}\u{438}\u{43c}\u{438}\u{437}\u{438}\u{440}\u{43e}\u{432}\u{430}\u{442}\u{44c} \u{441}\u{430}\u{439}\u{442}",
                &format!("{exe} \"%1\""),
            )?;
        } else {
            unregister_context_menu_entry(root, "SiteOptimizer");
        }

        if quick {
            register_context_menu_entry(
                root,
                "SiteOptimizerQuick",
                "\u{411}\u{44b}\u{441}\u{442}\u{440}\u{43e} \u{43e}\u{43f}\u{442}\u{438}\u{43c}\u{438}\u{437}\u{438}\u{440}\u{43e}\u{432}\u{430}\u{442}\u{44c} \u{441}\u{430}\u{439}\u{442}",
                &format!("{exe} --quick \"%1\""),
            )?;
        } else {
            unregister_context_menu_entry(root, "SiteOptimizerQuick");
        }
    }

    Ok(())
}

fn read_context_menu_settings() -> ContextMenuSettings {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let has_normal = hkcu
        .open_subkey("Software\\Classes\\SystemFileAssociations\\.zip\\shell\\SiteOptimizer")
        .is_ok()
        || hkcu
            .open_subkey("Software\\Classes\\Directory\\shell\\SiteOptimizer")
            .is_ok();
    let has_quick = hkcu
        .open_subkey("Software\\Classes\\SystemFileAssociations\\.zip\\shell\\SiteOptimizerQuick")
        .is_ok()
        || hkcu
            .open_subkey("Software\\Classes\\Directory\\shell\\SiteOptimizerQuick")
            .is_ok();

    ContextMenuSettings {
        normal: has_normal,
        quick: has_quick,
    }
}

#[tauri::command]
fn get_runtime_debug(app: AppHandle) -> Vec<String> {
    let mut debug = Vec::new();

    match std::env::current_exe() {
        Ok(path) => debug.push(format!("current_exe: {}", path.display())),
        Err(err) => debug.push(format!("current_exe: <error: {}>", err)),
    }

    match std::env::current_dir() {
        Ok(path) => debug.push(format!("current_dir: {}", path.display())),
        Err(err) => debug.push(format!("current_dir: <error: {}>", err)),
    }

    match app.path().resource_dir() {
        Ok(path) => debug.push(format!("resource_dir: {}", path.display())),
        Err(err) => debug.push(format!("resource_dir: <error: {}>", err)),
    }

    debug.push(format!(
        "launch_arg: {}",
        std::env::args().nth(1).unwrap_or_else(|| "<none>".to_string())
    ));

    match node_command() {
        Ok(path) => debug.push(format!("node: {}", PathBuf::from(path).display())),
        Err(err) => debug.push(format!("node: <error: {}>", err)),
    }

    match sidecar_path(&app) {
        Ok(path) => debug.push(format!("sidecar: {}", path.display())),
        Err(err) => debug.push(format!("sidecar: <error: {}>", err)),
    }

    debug
}

#[tauri::command]
fn show_main_window(app: AppHandle) -> Result<(), String> {
    show_main_window_impl(&app)
}

#[tauri::command]
fn stop_current_operation(app: AppHandle) -> Result<(), String> {
    let Some(state) = app.try_state::<AppState>() else {
        return Ok(());
    };

    let pid = state.current_pid.swap(0, Ordering::SeqCst);
    if pid == 0 {
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("taskkill");
        command
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);

        command
            .status()
            .map_err(|e| format!("Не удалось остановить процесс: {}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = pid;
    }

    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        state.allow_exit.store(true, Ordering::SeqCst);
    }
    app.exit(0);
}

#[tauri::command]
fn get_context_menu_settings() -> ContextMenuSettings {
    read_context_menu_settings()
}

#[tauri::command]
fn set_context_menu_settings(normal: bool, quick: bool) -> Result<ContextMenuSettings, String> {
    apply_context_menu_settings(normal, quick)?;
    Ok(read_context_menu_settings())
}

#[tauri::command]
async fn check_for_updates(
    app: AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<Option<UpdatePayload>, String> {
    let Some(update) = app
        .updater_builder()
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
    else {
        let mut pending = state.pending.lock().map_err(|e| e.to_string())?;
        *pending = None;
        return Ok(None);
    };

    let payload = UpdatePayload {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        notes: update.body.clone(),
        pub_date: update.date.map(|date| date.to_string()),
    };

    let mut pending = state.pending.lock().map_err(|e| e.to_string())?;
    *pending = Some(update);

    Ok(Some(payload))
}

#[tauri::command]
async fn install_pending_update(
    app: AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), String> {
    let update = {
        let mut pending = state.pending.lock().map_err(|e| e.to_string())?;
        pending
            .take()
            .ok_or_else(|| "Нет подготовленного обновления".to_string())?
    };

    let started_at = Instant::now();
    let app_for_progress = app.clone();

    let _ = app.emit(
        "update_download_progress",
        UpdateProgressPayload {
            state: "starting".to_string(),
            downloaded: 0,
            total: None,
            bytes_per_second: 0.0,
            eta_seconds: None,
            message: "Подготовка обновления…".to_string(),
        },
    );

    update
        .download_and_install(
            move |downloaded, total| {
                let downloaded = downloaded as u64;
                let elapsed = started_at.elapsed().as_secs_f64().max(0.001);
                let bytes_per_second = downloaded as f64 / elapsed;
                let eta_seconds = total.and_then(|full| {
                    if downloaded >= full || bytes_per_second <= 1.0 {
                        None
                    } else {
                        Some(((full - downloaded) as f64 / bytes_per_second).ceil() as u64)
                    }
                });

                let message = if let Some(total) = total {
                    format!("Скачано {} из {} байт", downloaded, total)
                } else {
                    format!("Скачано {} байт", downloaded)
                };

                let _ = app_for_progress.emit(
                    "update_download_progress",
                    UpdateProgressPayload {
                        state: "downloading".to_string(),
                        downloaded,
                        total,
                        bytes_per_second,
                        eta_seconds,
                        message,
                    },
                );
            },
            {
                let app = app.clone();
                move || {
                    let _ = app.emit(
                        "update_download_progress",
                        UpdateProgressPayload {
                            state: "installing".to_string(),
                            downloaded: 0,
                            total: None,
                            bytes_per_second: 0.0,
                            eta_seconds: None,
                            message: "Файлы загружены. Устанавливаем обновление…".to_string(),
                        },
                    );
                }
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    let _ = app.emit(
        "update_download_progress",
        UpdateProgressPayload {
            state: "done".to_string(),
            downloaded: 0,
            total: None,
            bytes_per_second: 0.0,
            eta_seconds: None,
            message: "Обновление установлено. Перезапуск приложения…".to_string(),
        },
    );

    app.restart();
}

fn run_sidecar(app: AppHandle, args: Vec<String>) -> Result<(), String> {
    let script = sidecar_path(&app)?
        .canonicalize()
        .map_err(|e| format!("Failed to resolve optimizer.js: {}", e))?;

    if script
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| !name.eq_ignore_ascii_case("optimizer.js"))
        .unwrap_or(true)
    {
        return Err(format!("Invalid sidecar entrypoint: {}", script.display()));
    }

    let node = node_command()?;
    let mut command = Command::new(node);
    command
        .arg(normalize_path_for_node(&script))
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start optimizer: {}", e))?;

    if let Some(state) = app.try_state::<AppState>() {
        state.current_pid.store(child.id(), Ordering::SeqCst);
    }

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
    if let Some(state) = app.try_state::<AppState>() {
        state.current_pid.store(0, Ordering::SeqCst);
    }
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
async fn open_zip_dialog_multi(app: AppHandle) -> Vec<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_title("Select site ZIP archives")
        .add_filter("ZIP Archive", &["zip"])
        .blocking_pick_files()
        .map(|paths| paths.into_iter().map(|p| p.to_string()).collect())
        .unwrap_or_default()
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
async fn open_folder_dialog_multi(app: AppHandle) -> Vec<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_title("Select site folders")
        .blocking_pick_folders()
        .map(|paths| paths.into_iter().map(|p| p.to_string()).collect())
        .unwrap_or_default()
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
async fn optimize_site(
    app: AppHandle,
    work_dir: String,
    remove_unused: bool,
    dedupe_images: bool,
) -> Result<(), String> {
    let wd = work_dir.clone();
    tokio::task::spawn_blocking(move || {
        let mut args = vec!["optimize".into(), wd];
        if remove_unused {
            args.push("--remove-unused".into());
        }
        if dedupe_images {
            args.push("--dedupe-images".into());
        }
        run_sidecar(app, args)
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

#[tauri::command]
fn get_launch_mode() -> String {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(|arg| arg == "--quick").unwrap_or(false) {
        "quick".to_string()
    } else {
        "normal".to_string()
    }
}

fn is_valid_launch_target(arg: &str) -> bool {
    let path = PathBuf::from(arg);

    if !path.exists() {
        return false;
    }

    let Ok(metadata) = std::fs::metadata(&path) else {
        return false;
    };

    if !metadata.is_file() && !metadata.is_dir() {
        return false;
    }

    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };

    !name.trim().is_empty()
}

#[tauri::command]
fn get_launch_paths() -> Vec<String> {
    let mut args = std::env::args().skip(1);
    let mut values: Vec<String> = args.by_ref().collect();

    if values.first().map(|arg| arg == "--quick").unwrap_or(false) {
        values.remove(0);
    }

    values
        .into_iter()
        .filter(|arg| is_valid_launch_target(arg))
        .collect()
}

#[tauri::command]
fn get_launch_path() -> Option<String> {
    get_launch_paths().into_iter().next()
}

fn emit_launch_requested(app: &AppHandle, args: Vec<String>) {
    let is_quick = args.iter().any(|arg| arg == "--quick");
    let payload = LaunchPayload {
        mode: if is_quick {
            "quick".to_string()
        } else {
            "normal".to_string()
        },
        paths: args
            .into_iter()
            .filter(|arg| arg != "--quick" && is_valid_launch_target(arg))
            .collect(),
    };

    if payload.paths.is_empty() {
        return;
    }

    let _ = app.emit("launch_requested", payload);
}

fn emit_close_requested(app: &AppHandle) {
    let _ = app.emit("window_close_requested", ());
}

fn main() {
    tauri::Builder::default()
        .manage(AppState::default())
        .manage(UpdateState::default())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            emit_launch_requested(app, args);
            let _ = show_main_window_impl(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())
                .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_zip_dialog,
            open_zip_dialog_multi,
            open_folder_dialog,
            open_folder_dialog_multi,
            unzip_site,
            prepare_folder,
            optimize_site,
            export_as_zip,
            export_as_folder,
            cleanup_work_dir,
            get_launch_mode,
            get_launch_paths,
            get_launch_path,
            get_runtime_debug,
            show_main_window,
            stop_current_operation,
            quit_app,
            get_context_menu_settings,
            set_context_menu_settings,
            check_for_updates,
            install_pending_update
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let allow_exit = app
                    .try_state::<AppState>()
                    .map(|state| state.allow_exit.load(Ordering::SeqCst))
                    .unwrap_or(false);

                if !allow_exit {
                    api.prevent_close();
                    emit_close_requested(&app);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                let allow_exit = app
                    .try_state::<AppState>()
                    .map(|state| state.allow_exit.load(Ordering::SeqCst))
                    .unwrap_or(false);

                if !allow_exit {
                    api.prevent_exit();
                }
            }
        });
}
