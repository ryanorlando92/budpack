#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use calamine::{open_workbook, Data, Reader, Xlsx};
use chrono::{Duration as ChronoDuration, NaiveDate};
use serde::{Serialize, Deserialize};
use std::time::Duration;
use std::sync::{Arc, Mutex};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri::Listener;
use tokio::sync::oneshot;
use tokio::sync::mpsc::channel;
use tokio::time::{timeout, sleep};


#[derive(Clone, Serialize)]
struct ProgressStatus {
    current: usize,
    total: usize,
    message: String,
}

#[derive(Clone, Serialize)]
struct MissingField {
    row_idx: u32,
    col_idx: u32,
    row_name: String,
    field_name: String,
}

#[derive(Deserialize)]
struct FieldUpdate {
    row_idx: u32,
    col_idx: u32,
    value: String,
}

#[tauri::command]
fn scan_empty_fields(file_path: String) -> Result<Vec<MissingField>, String> {
    let mut excel: Xlsx<_> = open_workbook(&file_path).map_err(|e| format!("Excel Error: {}", e))?;
    let sheet = excel.sheet_names().first().cloned().ok_or("No sheets found")?;
    let range = excel.worksheet_range(&sheet).map_err(|e| e.to_string())?;

    let mut missing = Vec::new();

    // Map the Calamine index (0-based) to the Umya index (1-based)
    let cols_to_check = vec![
        (0, 1, "Ext Package ID (Metrc)"),
        (3, 4, "Quantity"),
        (4, 5, "NDC"),
        (5, 6, "Lot/Batch ID"),
        (6, 7, "Expiration Date"),
        (7, 8, "Packaging Date"),
    ];

    for (i, row) in range.rows().enumerate().skip(1) {
        let row_name = row.get(2).map(|d| d.to_string()).unwrap_or_default(); // Column C
        let metrc = row.get(0).map(|d| d.to_string()).unwrap_or_default();
        
        if metrc.is_empty() && row_name.is_empty() { break; }

        for (cal_idx, umya_idx, col_name) in &cols_to_check {
            let val = row.get(*cal_idx).map(|d| d.to_string()).unwrap_or_default();
            if val.trim().is_empty() {
                missing.push(MissingField {
                    row_idx: (i + 1) as u32,
                    col_idx: *umya_idx,
                    row_name: row_name.clone(),
                    field_name: col_name.to_string(),
                });
            }
        }
    }
    Ok(missing)
}

#[tauri::command]
fn save_empty_fields(file_path: String, updates: Vec<FieldUpdate>) -> Result<(), String> {
    if updates.is_empty() { return Ok(()); }
    
    let path = Path::new(&file_path);
    let mut book = umya_spreadsheet::reader::xlsx::read(path).map_err(|e| format!("Failed to read Excel for writing: {}", e))?;
    
    let sheet = book.get_sheet_mut(&0).ok_or("Could not get first sheet")?;

    for update in updates {
        sheet.get_cell_mut((update.col_idx, update.row_idx)).set_value(update.value);
    }

    umya_spreadsheet::writer::xlsx::write(&book, path).map_err(|e| format!("Failed to save Excel file. Make sure it is closed. Error: {}", e))?;
    Ok(())
}

fn emit_progress(app: &AppHandle, current: usize, total: usize, message: &str) {
    let _ = app.emit(
        "import-progress",
        ProgressStatus {
            current,
            total,
            message: message.to_string(),
        },
    );
}

fn format_excel_date(data: &Data) -> String {
    let raw = data.to_string();
    if raw.trim().is_empty() {
        return String::new();
    }
    if raw.contains('/') || raw.contains('-') {
        return raw;
    }
    if let Ok(serial) = raw.parse::<f64>() {
        if let Some(epoch) = NaiveDate::from_ymd_opt(1899, 12, 30) {
            let date = epoch + ChronoDuration::days(serial as i64);
            return date.format("%m/%d/%Y").to_string();
        }
    }
    raw
}

#[tauri::command]
async fn start_import(app: AppHandle, file_path: String, is_bh: bool) -> Result<(), String> {
    let sweed_window = app
        .get_webview_window("sweed")
        .ok_or("Linked Sweed window not found. Please restart the app.")?;

    sweed_window.set_focus().map_err(|e| e.to_string())?;
    emit_progress(&app, 0, 0, "Reading Excel File...");

    let mut excel: Xlsx<_> =
        open_workbook(&file_path).map_err(|e| format!("Excel Error: {}", e))?;
    let sheet = excel
        .sheet_names()
        .first()
        .cloned()
        .ok_or("No sheets found")?;
    let range = excel.worksheet_range(&sheet).map_err(|e| e.to_string())?;
    let total_rows = range.get_size().0.saturating_sub(1);

    for (i, row) in range.rows().skip(1).enumerate() {

        if !sweed_window.is_focused().unwrap_or(true) {
            
            let (tx, rx) = oneshot::channel();

            app.dialog()
                .message("Automation paused because the window lost focus.\n\nPlease ensure the Receive Inventory window is active, then click OK to resume.")
                .title("Packagie Paused")
                .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
                .show(move |_| {
                    // This closure fires ONLY when the user clicks 'OK'
                    let _ = tx.send(()); 
                });

            let _ = rx.await;

            sleep(Duration::from_millis(500)).await;
        }

        let current_row = i + 1;

        let metrc = row.get(0).map(|d| d.to_string()).unwrap_or_default();
        if metrc.is_empty() {
            break;
        }

        let qty = row.get(3).map(|d| d.to_string()).unwrap_or_default();
        let ndc = row.get(4).map(|d| d.to_string()).unwrap_or_default();
        let lot = row.get(5).map(|d| d.to_string()).unwrap_or_default();
        let exp_date = format_excel_date(row.get(6).unwrap_or(&Data::Empty));
        let pack_date = format_excel_date(row.get(7).unwrap_or(&Data::Empty));
        let package_id_val = if is_bh { &lot } else { &ndc };

        emit_progress(
            &app,
            current_row,
            total_rows,
            &format!("Processing Row {}...", current_row),
        );

        let js_payload = format!(
            r#"
            (async function() {{
                const delay = ms => new Promise(r => setTimeout(r, ms));
                
                const injectField = async (identifier, val, isDate = false) => {{
                    if (!val || val === "") return;
                    let el = document.getElementById(identifier);
                    if (!el) {{ try {{ el = document.querySelector(identifier); }} catch(e) {{}} }}
                    if (!el) return;

                    const wrapper = el.closest('.MuiInputBase-root');
                    if (wrapper) {{
                        const clearBtn = wrapper.querySelector('button[data-testid="clear-date-input"]');
                        if (clearBtn) {{ clearBtn.click(); await delay(100); }}
                    }}

                    el.focus(); 
                    await delay(50);

                    const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                    ns.call(el, val);
                    el.dispatchEvent(new Event("input", {{ bubbles: true }}));
                    el.dispatchEvent(new Event("change", {{ bubbles: true }}));
                    el.dispatchEvent(new KeyboardEvent("keydown", {{ key: "Enter", keyCode: 13, bubbles: true }}));

                    el.blur();
                    await delay(150);
                }};

                if (!document.querySelector("div[data-testid=receive-inventory-details_sr_product]")) {{
                    document.querySelector("button[data-testid=receive-inventory_button_add]")?.click();
                    await delay(200); 
                }}

                const prod = document.querySelector("input[data-testid=receive-inventory-details_sr_product]");
                if (prod) {{
                    prod.focus(); prod.click();
                    await delay(200);
                    
                    const search = document.querySelector("input[data-testid=receive-package-modal-products-dropdown-search-input]");
                    if (search) {{
                        search.focus();
                        const ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                        ns.call(search, "{ndc}");
                        search.dispatchEvent(new Event("input", {{bubbles: true}}));
                        
                        await delay(200); 
                        
                        const opt = document.querySelector("li[data-option-index='0']");
                        if (opt) {{
                            opt.dispatchEvent(new MouseEvent('mousedown', {{ bubbles: true, cancelable: true }}));
                            await delay(50);
                            opt.dispatchEvent(new MouseEvent('mouseup', {{ bubbles: true, cancelable: true }}));
                            opt.click();
                        }}
                    }}
                }}
                await delay(200);

                await injectField("input[data-testid=receive-inventory-details_sr_quantity]", "{qty}");
                await injectField("input-input_Package ID", "{package_id_val}");
                await injectField("input-input_External package ID", "{metrc}");
                await injectField("input-input_Lot name/batch ID", "{lot}");
                await injectField("input-input_Expiration date", "{exp_date}", true);
                await delay(50);
                await injectField("input-input_Packaging date", "{pack_date}", true);

                await delay(200);

                const saveBtn = document.querySelector("button[data-testid=receive-inventory-details_button_save]");
                if (saveBtn && !saveBtn.disabled) {{
                    saveBtn.click();
                    await delay(100);
                    window.__TAURI__.event.emit("row_complete");
                }}
            }})();
        "#
        );

        let (tx, rx) = oneshot::channel();
        let tx_mutex = Arc::new(Mutex::new(Some(tx)));

        let event_id = app.listen_any("row_complete", move |_| {
            if let Some(sender) = tx_mutex.lock().unwrap().take() {
                let _ = sender.send(());
            }
        });

        sweed_window.eval(&js_payload).map_err(|e| e.to_string())?;

        let _ = timeout(Duration::from_secs(10), rx).await;

        app.unlisten(event_id);

        sleep(Duration::from_millis(100)).await;
    }

    emit_progress(&app, total_rows, total_rows, "Import Complete!");
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if _window.label() == "main" {
                    let app = _window.app_handle();
                    if let Some(sweed) = app.get_webview_window("sweed") {
                        let _ = sweed.destroy();
                    }
                }
            }
        })
        .setup(|app| {
            WebviewWindowBuilder::new(
                app,
                "sweed",
                WebviewUrl::External(
                    "https://store.sweedpos.com/inventory/purchases"
                        .parse()
                        .unwrap(),
                ),
            )
            .title("Budpack - Receive Inventory")
            .inner_size(1100.0, 850.0)
            .maximized(true)
            .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![start_import, scan_empty_fields, save_empty_fields])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
