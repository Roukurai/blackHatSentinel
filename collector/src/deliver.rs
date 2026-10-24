use std::fs;
use std::io::Write;
use std::path::Path;
use std::thread;
use std::time::Duration;

use crate::event::{EventsResponse, SentinelEvent};

const BACKOFF_SECS: [u64; 3] = [1, 2, 4];

#[derive(Debug)]
pub enum PostError {
    Client { status: u16, body: String },
    Retryable(String),
}

impl std::fmt::Display for PostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PostError::Client { status, body } => {
                write!(f, "API rejected batch with HTTP {status}: {body}")
            }
            PostError::Retryable(msg) => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for PostError {}

pub fn post_batch(url: &str, events: &[SentinelEvent]) -> Result<EventsResponse, PostError> {
    let body = serde_json::to_string(events)
        .map_err(|e| PostError::Retryable(format!("serialize: {e}")))?;
    let mut last = PostError::Retryable("no attempts".into());
    for (i, delay) in std::iter::once(0u64).chain(BACKOFF_SECS).enumerate() {
        if delay > 0 {
            thread::sleep(Duration::from_secs(delay));
        }
        match try_once(url, &body) {
            Ok(resp) => return Ok(resp),
            Err(PostError::Client { status, body }) => {
                return Err(PostError::Client { status, body });
            }
            Err(e) => {
                last = e;
                let remaining = 3 - i;
                if remaining == 0 {
                    break;
                }
            }
        }
    }
    Err(last)
}

fn try_once(url: &str, body: &str) -> Result<EventsResponse, PostError> {
    match ureq::post(url)
        .timeout(Duration::from_secs(15))
        .set("Content-Type", "application/json")
        .send_string(body)
    {
        Ok(resp) => read_ok(resp),
        Err(ureq::Error::Status(code, resp)) => {
            let text = resp.into_string().unwrap_or_default();
            if (400..500).contains(&code) {
                Err(PostError::Client {
                    status: code,
                    body: text,
                })
            } else {
                Err(PostError::Retryable(format!("HTTP {code}: {text}")))
            }
        }
        Err(e) => Err(PostError::Retryable(e.to_string())),
    }
}

fn read_ok(resp: ureq::Response) -> Result<EventsResponse, PostError> {
    let text = resp
        .into_string()
        .map_err(|e| PostError::Retryable(format!("read body: {e}")))?;
    match serde_json::from_str::<EventsResponse>(&text) {
        Ok(parsed) => Ok(parsed),
        Err(_) => Ok(EventsResponse {
            accepted: 0,
            duplicates: 0,
        }),
    }
}

pub fn read_cursor(path: &Path) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn persist_cursor(path: &Path, cursor: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }
    let tmp = {
        let mut name = path
            .file_name()
            .unwrap_or_else(|| std::ffi::OsStr::new("cursor"))
            .to_os_string();
        name.push(".tmp");
        path.with_file_name(name)
    };
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(cursor.as_bytes())?;
        f.write_all(b"\n")?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}
