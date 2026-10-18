use std::fs;
use std::path::PathBuf;

use tauri::menu::{Menu, MenuItem};
use tauri::Emitter;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tauri_plugin_global_shortcut::ShortcutState;
use tauri_plugin_sql::{Migration, MigrationKind};

/// 数据库文件：`%APPDATA%\com.dsh.todolist\todolist.db`
/// （Tauri 会把相对路径的 sqlite 库放到 app config 目录，不放在 exe 旁边）
const DB_URL: &str = "sqlite:todolist.db";
const DB_FILE: &str = "todolist.db";
const BACKUP_DIR: &str = "backup";
/// 保留最近多少份每日备份
const KEEP_BACKUPS: usize = 7;

/// 表结构演进靠这里的迁移，不要在 JS 里写 CREATE TABLE。
/// 规则：只增不改（已发布的迁移永远不要再动），新需求追加下一条。
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_task_table",
            sql: "
                CREATE TABLE IF NOT EXISTS task (
                    id         TEXT    PRIMARY KEY NOT NULL,
                    title      TEXT    NOT NULL,
                    notes      TEXT,
                    done       INTEGER NOT NULL DEFAULT 0,
                    due_at     TEXT,
                    priority   INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT    NOT NULL,
                    updated_at TEXT    NOT NULL,
                    deleted_at TEXT
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_task_indexes",
            sql: "
                CREATE INDEX IF NOT EXISTS idx_task_due     ON task (done, due_at);
                CREATE INDEX IF NOT EXISTS idx_task_deleted ON task (deleted_at);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_task_color",
            sql: "ALTER TABLE task ADD COLUMN color TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add_task_pinned_at",
            sql: "
                ALTER TABLE task ADD COLUMN pinned_at TEXT;
                CREATE INDEX IF NOT EXISTS idx_task_pinned ON task (pinned_at);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add_task_sort_order",
            // 手动排序需要显式的顺序字段。老数据按"原来的显示顺序"回填一次，
            // 回填完排序就完全交给 sort_order，不再看截止时间。
            sql: "
                ALTER TABLE task ADD COLUMN sort_order REAL;
                UPDATE task
                   SET sort_order = (
                         SELECT rn
                           FROM (SELECT id,
                                        ROW_NUMBER() OVER (
                                            PARTITION BY (pinned_at IS NULL)
                                            ORDER BY pinned_at DESC,
                                                     done ASC,
                                                     due_at IS NULL ASC,
                                                     due_at ASC,
                                                     created_at DESC
                                        ) - 1 AS rn
                                   FROM task) AS ranked
                          WHERE ranked.id = task.id
                       );
                CREATE INDEX IF NOT EXISTS idx_task_sort ON task (sort_order);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "create_subtask_table",
            sql: "
                CREATE TABLE IF NOT EXISTS subtask (
                    id         TEXT    PRIMARY KEY NOT NULL,
                    task_id    TEXT    NOT NULL,
                    title      TEXT    NOT NULL,
                    done       INTEGER NOT NULL DEFAULT 0,
                    sort_order REAL    NOT NULL DEFAULT 0,
                    created_at TEXT    NOT NULL,
                    updated_at TEXT    NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_subtask_task ON subtask (task_id);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add_task_notified_at",
            // 记住"这条任务的到期提醒已经弹过"，避免每次轮询重复打扰
            sql: "ALTER TABLE task ADD COLUMN notified_at TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "add_task_recurrence",
            // 循环规则存 JSON：{kind:'daily'} / {kind:'weekly',weekdays:[5]} / {kind:'monthly',day:15}
            sql: "ALTER TABLE task ADD COLUMN recurrence TEXT;",
            kind: MigrationKind::Up,
        },
    ]
}

/* ------------------------------------------------------------------ 窗口 */

/// 把主窗口从托盘里叫回来（最小化过的也还原）
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// 托盘图标 + 右键菜单。左键点图标直接显示窗口，菜单里只留「显示 / 退出」。
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("待办清单")
        .menu(&menu)
        // 左键单击就是「显示窗口」，别同时弹菜单
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            // 只有这里能真正退出：点窗口的 X 只是收进托盘
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

/* ------------------------------------------------------------------ 备份 */

fn backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(BACKUP_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// 只保留最近 KEEP_BACKUPS 份（文件名是 todolist-yyyyMMdd.db，字典序即时间序）
fn prune_backups(dir: &PathBuf) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut names: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("todolist-") && name.ends_with(".db"))
        .collect();
    names.sort();

    // 先把位置腾出来，今天这一份才放得进 7 份的额度
    if names.len() >= KEEP_BACKUPS {
        let excess = names.len() - KEEP_BACKUPS + 1;
        for name in names.iter().take(excess) {
            let _ = fs::remove_file(dir.join(name));
        }
    }
}

/// 返回今天该写的备份文件路径；今天已经备份过、或者数据库还没建好时返回 None。
/// 真正的拷贝由前端用 `VACUUM INTO` 完成（见 src/services/backupService.ts），
/// 这样拿到的是 SQLite 保证的一致性快照，而不是可能有半条事务的文件副本。
#[tauri::command]
fn prepare_daily_backup(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    if !config_dir.join(DB_FILE).exists() {
        return Ok(None);
    }

    let dir = backup_dir(&app)?;
    prune_backups(&dir);

    let target = dir.join(format!(
        "todolist-{}.db",
        chrono::Local::now().format("%Y%m%d")
    ));
    if target.exists() {
        return Ok(None);
    }
    Ok(Some(target.to_string_lossy().into_owned()))
}

/// `VACUUM INTO` 失败时清掉可能留下的半成品，避免"今天已备份"的误判。
/// 只允许删除 backup 目录里的文件。
#[tauri::command]
fn discard_backup(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = backup_dir(&app)?;
    let target = PathBuf::from(&path);
    if target.parent() != Some(dir.as_path()) {
        return Err("refusing to touch a file outside the backup directory".into());
    }
    if target.exists() {
        fs::remove_file(&target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 快速记完一条后把窗口收回托盘（放 Rust 侧，前端就不用申请窗口权限）
#[tauri::command]
fn hide_main_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// 轻量诊断日志：写 `<配置目录>/app.log`。
/// 前端拿不到控制台的地方（比如托盘里的后台定时器）靠它排查问题。
#[tauri::command]
fn log_line(app: tauri::AppHandle, message: String) -> Result<(), String> {
    use std::io::Write;

    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("app.log");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    writeln!(file, "[{stamp}] {message}").map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例必须最先注册：第二次启动时把已有窗口叫到前台，然后自己退出
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        // 全局快捷键：任何程序前台时按 Ctrl+Shift+Space，直接把窗口叫出来并聚焦输入框
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["ctrl+shift+space"])
                .expect("invalid global shortcut")
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        show_main_window(app);
                        let _ = app.emit("quick-add", ());
                    }
                })
                .build(),
        )
        .setup(|app| {
            build_tray(app.handle())?;
            Ok(())
        })
        // 点 X 不退出，只收进托盘（退出走托盘菜单）
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            prepare_daily_backup,
            discard_backup,
            hide_main_window,
            log_line
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
