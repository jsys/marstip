use serde::{Deserialize, Serialize};
use std::net::UdpSocket;
use std::time::Duration;

const DEVICE_IP: &str = "192.168.1.69";
const DEVICE_PORT: u16 = 30000;
const TIMEOUT_MS: u64 = 5000;

#[derive(Serialize, Deserialize)]
struct ApiRequest {
    id: u32,
    method: String,
    params: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DeviceInfo {
    pub device: Option<String>,
    pub ver: Option<u32>,
    pub ble_mac: Option<String>,
    pub wifi_mac: Option<String>,
    pub wifi_name: Option<String>,
    pub ip: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BatteryStatus {
    pub soc: Option<u32>,
    pub charg_flag: Option<bool>,
    pub dischrg_flag: Option<bool>,
    pub bat_temp: Option<f32>,
    pub bat_capacity: Option<f32>,
    pub rated_capacity: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EnergyStatus {
    pub bat_soc: Option<u32>,
    pub bat_cap: Option<f32>,
    pub pv_power: Option<f32>,
    pub ongrid_power: Option<f32>,
    pub offgrid_power: Option<f32>,
    pub bat_power: Option<f32>,
    pub total_pv_energy: Option<f32>,
    pub total_grid_output_energy: Option<f32>,
    pub total_grid_input_energy: Option<f32>,
    pub total_load_energy: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ModeStatus {
    pub mode: Option<String>,
    pub ongrid_power: Option<f32>,
    pub offgrid_power: Option<f32>,
    pub bat_soc: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MeterStatus {
    pub ct_state: Option<u32>,
    pub a_power: Option<f32>,
    pub b_power: Option<f32>,
    pub c_power: Option<f32>,
    pub total_power: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct WifiStatus {
    pub ssid: Option<String>,
    pub rssi: Option<i32>,
    pub sta_ip: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct DashboardData {
    pub device: DeviceInfo,
    pub battery: BatteryStatus,
    pub energy: EnergyStatus,
    pub mode: ModeStatus,
    pub meter: MeterStatus,
    pub wifi: WifiStatus,
    pub timestamp: String,
}

fn send_command(method: &str, params: serde_json::Value) -> Result<serde_json::Value, String> {
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.set_read_timeout(Some(Duration::from_millis(TIMEOUT_MS))).map_err(|e| e.to_string())?;

    let request = ApiRequest {
        id: 1,
        method: method.to_string(),
        params,
    };

    let message = serde_json::to_string(&request).map_err(|e| e.to_string())?;
    let addr = format!("{}:{}", DEVICE_IP, DEVICE_PORT);

    socket.send_to(message.as_bytes(), &addr).map_err(|e| e.to_string())?;

    let mut buf = [0u8; 4096];
    let (len, _) = socket.recv_from(&mut buf).map_err(|e| e.to_string())?;

    let response: serde_json::Value = serde_json::from_slice(&buf[..len]).map_err(|e| e.to_string())?;

    Ok(response.get("result").cloned().unwrap_or(serde_json::Value::Null))
}

#[tauri::command]
fn get_dashboard() -> Result<DashboardData, String> {
    let device_result = send_command("Marstek.GetDevice", serde_json::json!({"ble_mac": "0"}))?;
    let device: DeviceInfo = serde_json::from_value(device_result).unwrap_or(DeviceInfo {
        device: None, ver: None, ble_mac: None, wifi_mac: None, wifi_name: None, ip: None,
    });

    let es_result = send_command("ES.GetStatus", serde_json::json!({"id": 0}))?;
    let energy: EnergyStatus = serde_json::from_value(es_result).unwrap_or(EnergyStatus {
        bat_soc: None, bat_cap: None, pv_power: None, ongrid_power: None, offgrid_power: None,
        bat_power: None, total_pv_energy: None, total_grid_output_energy: None,
        total_grid_input_energy: None, total_load_energy: None,
    });

    let bat_result = send_command("Bat.GetStatus", serde_json::json!({"id": 0}))?;
    let battery: BatteryStatus = serde_json::from_value(bat_result).unwrap_or(BatteryStatus {
        soc: None, charg_flag: None, dischrg_flag: None, bat_temp: None, bat_capacity: None, rated_capacity: None,
    });

    let wifi_result = send_command("Wifi.GetStatus", serde_json::json!({"id": 0}))?;
    let wifi: WifiStatus = serde_json::from_value(wifi_result).unwrap_or(WifiStatus {
        ssid: None, rssi: None, sta_ip: None,
    });

    let mode_result = send_command("ES.GetMode", serde_json::json!({"id": 0}))?;
    let mode: ModeStatus = serde_json::from_value(mode_result).unwrap_or(ModeStatus {
        mode: None, ongrid_power: None, offgrid_power: None, bat_soc: None,
    });

    let em_result = send_command("EM.GetStatus", serde_json::json!({"id": 0}))?;
    let meter: MeterStatus = serde_json::from_value(em_result).unwrap_or(MeterStatus {
        ct_state: None, a_power: None, b_power: None, c_power: None, total_power: None,
    });

    let timestamp = chrono::Local::now().format("%H:%M:%S").to_string();

    Ok(DashboardData {
        device,
        battery,
        energy,
        mode,
        meter,
        wifi,
        timestamp,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_dashboard])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
