//! Adaptive performance. A one-time benchmark (10 s through Nemotron, see the sidecar's
//! `benchmark` request) plus hardware facts decide a tier, cached in `transcription-tier.json`:
//! - `high`: live text comfortably faster than real time with headroom for the final pass
//! - `mid`: live text works; the final pass may take a while
//! - `below-floor`: no live text (record-only), transcript produced after stopping
//!
//! Battery state lowers the final pass's thread count instead of delaying it, so notes are
//! still ready right after class.

use super::catalog::{self, catalog};
use super::models;
use super::recording::LIVE_ID;
use super::sidecar;
use serde_json::{json, Value};
use std::path::Path;

/// Real-time-factor thresholds. Live decoding must stay well under 1.0 while capture, archiving,
/// and the UI also run, so the floor leaves ~40% headroom.
const HIGH_MAX_RTF: f64 = 0.3;
const MID_MAX_RTF: f64 = 0.6;
/// "16 GB" laptops report ~15.5 GiB, so 15 GiB is the practical 16 GB line.
const HIGH_MIN_RAM_GIB: f64 = 15.0;
const TIER_FILE: &str = "transcription-tier.json";

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Tier {
    High,
    Mid,
    BelowFloor,
}

impl Tier {
    pub fn as_str(self) -> &'static str {
        match self {
            Tier::High => "high",
            Tier::Mid => "mid",
            Tier::BelowFloor => "below-floor",
        }
    }
}

pub fn classify(rtf: f64, ram_gib: f64, vector_ok: bool) -> Tier {
    if !vector_ok || rtf >= MID_MAX_RTF {
        Tier::BelowFloor
    } else if rtf < HIGH_MAX_RTF && ram_gib >= HIGH_MIN_RAM_GIB {
        Tier::High
    } else {
        Tier::Mid
    }
}

pub struct Hardware {
    pub cores: usize,
    pub ram_gib: f64,
    pub avx2: bool,
    pub apple_silicon: bool,
}

pub fn hardware() -> Hardware {
    use sysinfo::{MemoryRefreshKind, RefreshKind, System};
    let ram_bytes = System::new_with_specifics(RefreshKind::nothing().with_memory(MemoryRefreshKind::nothing().with_ram()))
        .map(|system| system.total_memory())
        .unwrap_or(0);
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    let avx2 = std::arch::is_x86_feature_detected!("avx2");
    #[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
    let avx2 = false;
    Hardware {
        cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        ram_gib: ram_bytes as f64 / (1u64 << 30) as f64,
        avx2,
        apple_silicon: cfg!(all(target_os = "macos", target_arch = "aarch64")),
    }
}

/// True when the machine runs on battery power (false on desktops or if unknown).
pub fn on_battery() -> bool {
    starship_battery::Manager::new()
        .and_then(|manager| manager.batteries())
        .map(|mut batteries| {
            batteries.any(|battery| matches!(battery.map(|b| b.state()), Ok(starship_battery::State::Discharging)))
        })
        .unwrap_or(false)
}

/// Threads for the final pass: all-out on AC, gentle on battery.
pub fn final_pass_threads() -> i32 {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
    if on_battery() { cores.clamp(1, 2) as i32 } else { cores.clamp(1, 4) as i32 }
}

/// Cached tier, if the benchmark has run.
pub fn cached(app_data: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(app_data.join(TIER_FILE)).ok()?).ok()
}

pub fn cached_tier(app_data: &Path) -> Option<Tier> {
    match cached(app_data)?["tier"].as_str()? {
        "high" => Some(Tier::High),
        "mid" => Some(Tier::Mid),
        "below-floor" => Some(Tier::BelowFloor),
        _ => None,
    }
}

/// Returns the cached tier, or runs the benchmark (needs the live model) and caches it.
/// `Ok(None)` means the live model isn't installed yet.
pub fn load_or_measure(app_data: &Path) -> Result<Option<Value>, String> {
    if let Some(value) = cached(app_data) {
        return Ok(Some(value));
    }
    let models_dir = app_data.join("models");
    let entry = catalog::model(LIVE_ID).ok_or("unknown_model")?;
    if !models::is_installed(&models_dir, LIVE_ID, entry) {
        return Ok(None);
    }
    let pinned = |key: &str| -> Result<Value, String> {
        let file = entry.files.get(key).ok_or("unknown_model_file")?;
        Ok(json!({ "path": models::file_path(&models_dir, LIVE_ID, &file.name), "sha256": file.sha256 }))
    };
    let hw = hardware();
    let threads = hw.cores.clamp(1, 4) as i32;
    let request = json!({
        "type": "benchmark",
        "model": { "encoder": pinned("encoder")?, "decoder": pinned("decoder")?, "joiner": pinned("joiner")?, "tokens": pinned("tokens")? },
        "numThreads": threads,
    });
    let result = sidecar::run(&request, |_| {})?;
    let rtf = result["rtf"].as_f64().ok_or("benchmark_failed")?;
    let vector_ok = hw.avx2 || hw.apple_silicon || cfg!(not(any(target_arch = "x86", target_arch = "x86_64")));
    let tier = classify(rtf, hw.ram_gib, vector_ok);
    let value = json!({
        "tier": tier.as_str(),
        "rtf": rtf,
        "threads": threads,
        "cores": hw.cores,
        "ramGib": (hw.ram_gib * 10.0).round() / 10.0,
        "avx2": hw.avx2,
        "appleSilicon": hw.apple_silicon,
        // The pinned sherpa-onnx static build runs ONNX Runtime's CPU provider only.
        "providers": ["cpu"],
        "sherpaOnnxVersion": catalog().sherpa_onnx_version,
    });
    super::archive::write_atomic(&app_data.join(TIER_FILE), value.to_string().as_bytes()).map_err(|_| "io_error")?;
    Ok(Some(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_by_speed_memory_and_cpu_features() {
        assert_eq!(classify(0.19, 15.5, true), Tier::High); // this dev machine
        assert_eq!(classify(0.19, 8.0, true), Tier::Mid); // fast but low RAM
        assert_eq!(classify(0.45, 32.0, true), Tier::Mid);
        assert_eq!(classify(0.6, 32.0, true), Tier::BelowFloor);
        assert_eq!(classify(0.1, 32.0, false), Tier::BelowFloor); // x86 without AVX2
    }

    #[test]
    fn reads_hardware_without_panicking() {
        let hw = hardware();
        assert!(hw.cores >= 1);
        assert!(hw.ram_gib > 0.5, "total RAM detected: {}", hw.ram_gib);
    }
}
