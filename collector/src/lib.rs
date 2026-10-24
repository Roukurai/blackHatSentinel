pub mod config;
pub mod deliver;
pub mod event;
pub mod parse;
pub mod run;

pub use config::Config;
pub use event::{EventType, Origin, SentinelEvent};
pub use parse::{parse_journal_line, parse_message};
pub use run::{run, RunStats};

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};
    use std::thread;

    use super::*;
    use crate::event::EventsResponse;
    use crate::parse::{classify_line, LineOutcome};
    use std::io::Read;

    fn drain_http_request(stream: &mut impl Read) -> std::io::Result<Vec<u8>> {
        let mut buf = Vec::new();
        let mut tmp = [0u8; 4096];
        loop {
            let n = stream.read(&mut tmp)?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&tmp[..n]);
            if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                let header_end = i + 4;
                let content_length = std::str::from_utf8(&buf[..header_end])
                    .ok()
                    .and_then(|h| {
                        h.split("\r\n").find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse().ok())
                                .flatten()
                        })
                    })
                    .unwrap_or(0);
                if buf.len() >= header_end + content_length {
                    break;
                }
            }
        }
        Ok(buf)
    }

    fn fixtures_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures.jsonl")
    }

    #[test]
    fn fixtures_jsonl_emits_34_skips_2() {
        let body = std::fs::read_to_string(fixtures_path()).expect("fixtures.jsonl");
        let mut emitted = 0u64;
        let mut skipped = 0u64;
        for line in body.lines() {
            match classify_line(line, "ubuntu-01", Origin::Replay) {
                LineOutcome::Event => emitted += 1,
                LineOutcome::Skipped => skipped += 1,
            }
        }
        assert_eq!(emitted, 34, "expected 34 emitted events");
        assert_eq!(skipped, 2, "expected 2 skipped lines");
    }

    #[test]
    fn replay_mode_posts_fixtures_and_labels_origin() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let received: Arc<Mutex<Vec<SentinelEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let received_clone = received.clone();

        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let req = drain_http_request(&mut stream).unwrap();
            let text = String::from_utf8_lossy(&req);
            let body = text.split("\r\n\r\n").nth(1).unwrap_or("");
            let events: Vec<SentinelEvent> = serde_json::from_str(body).unwrap();
            *received_clone.lock().unwrap() = events;
            let resp = EventsResponse {
                accepted: 34,
                duplicates: 0,
            };
            let payload = serde_json::to_vec(&resp).unwrap();
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                payload.len()
            );
            stream.write_all(header.as_bytes()).unwrap();
            stream.write_all(&payload).unwrap();
        });

        let tmp = std::env::temp_dir().join(format!("sentinel-cursor-{}", std::process::id()));
        let _ = std::fs::remove_file(&tmp);

        let config = Config {
            host_id: "ubuntu-01".into(),
            api_url: format!("http://{addr}"),
            origin: Origin::Replay,
            replay_file: Some(fixtures_path()),
            state_file: Some(tmp.clone()),
            batch_max: 500,
        };
        let stats = run(&config).expect("replay run");
        assert_eq!(stats.emitted, 34);
        assert_eq!(stats.skipped, 2);
        assert_eq!(stats.accepted, 34);
        assert_eq!(stats.duplicates, 0);

        let events = received.lock().unwrap();
        assert_eq!(events.len(), 34);
        assert!(events.iter().all(|e| e.origin == Origin::Replay));
        assert!(events.iter().all(|e| e.host_id == "ubuntu-01"));
        assert!(std::fs::read_to_string(&tmp).unwrap().trim().len() > 0);
        let _ = std::fs::remove_file(&tmp);
    }
}
