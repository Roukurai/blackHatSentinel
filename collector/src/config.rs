use std::env;
use std::path::PathBuf;

use crate::event::Origin;

#[derive(Debug, Clone)]
pub struct Config {
    pub host_id: String,
    pub api_url: String,
    pub origin: Origin,
    pub replay_file: Option<PathBuf>,
    pub state_file: Option<PathBuf>,
    pub batch_max: usize,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let host_id = required("HOST_ID")?;
        let api_url = required("API_URL")?;
        let mode = env::var("COLLECTOR_MODE").unwrap_or_else(|_| "live".to_string());
        let origin = match mode.as_str() {
            "live" => Origin::Live,
            "replay" => Origin::Replay,
            other => {
                return Err(format!(
                    "COLLECTOR_MODE must be live or replay, got {other:?}"
                ))
            }
        };
        let replay_file = match origin {
            Origin::Replay => {
                let path = required("COLLECTOR_REPLAY_FILE")?;
                Some(PathBuf::from(path))
            }
            Origin::Live => env::var("COLLECTOR_REPLAY_FILE").ok().map(PathBuf::from),
        };
        let state_file = env::var("COLLECTOR_STATE_FILE")
            .ok()
            .filter(|s| !s.is_empty())
            .map(PathBuf::from);
        let batch_max = env::var("COLLECTOR_BATCH_MAX")
            .ok()
            .filter(|s| !s.is_empty())
            .map(|s| {
                s.parse::<usize>()
                    .map_err(|_| format!("COLLECTOR_BATCH_MAX is not a number: {s}"))
            })
            .transpose()?
            .unwrap_or(500)
            .clamp(1, 500);

        if origin == Origin::Replay {
            if let Some(path) = &replay_file {
                if path.as_os_str().is_empty() {
                    return Err("COLLECTOR_REPLAY_FILE is required in replay mode".into());
                }
            }
        }

        Ok(Self {
            host_id,
            api_url,
            origin,
            replay_file,
            state_file,
            batch_max,
        })
    }

    pub fn events_url(&self) -> String {
        format!("{}/events", self.api_url.trim_end_matches('/'))
    }
}

fn required(name: &str) -> Result<String, String> {
    env::var(name)
        .map_err(|_| format!("{name} is required"))
        .and_then(|s| {
            if s.is_empty() {
                Err(format!("{name} is required"))
            } else {
                Ok(s)
            }
        })
}
