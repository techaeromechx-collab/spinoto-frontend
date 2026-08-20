// Release builds attach to the "windows" subsystem so Windows does not open a
// console window behind the app. Debug builds keep the console, because that is
// where Rust panics and `println!` land during `tauri dev`.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    spinoto_crm_lib::run()
}
