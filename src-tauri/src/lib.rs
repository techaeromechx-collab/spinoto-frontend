// Spinoto CRM — Tauri desktop shell.
//
// This file is deliberately almost empty, and should stay that way.
//
// The desktop app is the SAME React application that runs at crm.spinoto.ai.
// Nothing about the CRM — pricing, discounts, invoices, estimates, permissions,
// authentication — lives here. All of it stays in the frontend and behind the
// existing Node/Express + PostgreSQL API. This process only opens a window and
// points a webview at the bundled build.
//
// Two plugins are registered, and both exist for one reason: the browser build
// opens PDFs with `window.open(blobUrl, '_blank')`, which a webview with no
// tabs cannot do. `fs` writes the PDF to the temp directory and `opener` hands
// it to the OS viewer. See src/lib/documentPdf.js.
//
// Before adding a plugin here, check it is actually needed — every one widens
// what the web page can reach on the user's machine.
//
// `notification` is the third, and it exists because the web path does not work
// here. In a browser a new WhatsApp message raises `new Notification(...)` and,
// with the tab closed, arrives by Web Push. Neither is available in WebView2:
// there is no push service behind it and no PushManager on the window. The OS
// toast has to be raised through this plugin instead. See src/lib/notify.js,
// which picks the route at runtime so the React code never asks where it is.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("error while running Spinoto CRM");
}
