use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use crate::config::Config;
use crate::deliver::{persist_cursor, post_batch, read_cursor};
use crate::event::{Origin, SentinelEvent};
use crate::parse::parse_journal_line;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct RunStats {
    pub emitted: u64,
    pub skipped: u64,
    pub accepted: u64,
    pub duplicates: u64,
}

pub fn run(config: &Config) -> Result<RunStats, Box<dyn std::error::Error>> {
    match config.origin {
        Origin::Replay => {
            let path = config
                .replay_file
                .as_ref()
                .ok_or("COLLECTOR_REPLAY_FILE is required in replay mode")?;
            let file = File::open(path)?;
            run_reader(config, BufReader::new(file))
        }
        Origin::Live => {
            let mut cmd = Command::new("journalctl");
            cmd.arg("-u")
                .arg("ssh")
                .arg("-o")
                .arg("json")
                .arg("--follow");
            if let Some(state) = &config.state_file {
                if let Some(cursor) = read_cursor(state) {
                    cmd.arg("--after-cursor").arg(cursor);
                }
            }
            cmd.stdout(Stdio::piped());
            cmd.stderr(Stdio::inherit());
            let mut child = cmd.spawn().map_err(|e| {
                format!("failed to spawn journalctl -u ssh -o json --follow: {e}")
            })?;
            let stdout = child
                .stdout
                .take()
                .ok_or("journalctl produced no stdout")?;
            let result = run_follow(config, BufReader::new(stdout));
            let _ = child.kill();
            let _ = child.wait();
            result
        }
    }
}

fn run_reader<R: BufRead>(
    config: &Config,
    reader: R,
) -> Result<RunStats, Box<dyn std::error::Error>> {
    let mut ctx = BatchCtx::new(config);
    for line in reader.lines() {
        ctx.push_line(&line?)?;
    }
    ctx.finish()
}

fn run_follow<R: BufRead + Send + 'static>(
    config: &Config,
    reader: R,
) -> Result<RunStats, Box<dyn std::error::Error>> {
    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        for line in reader.lines() {
            match line {
                Ok(l) => {
                    if tx.send(l).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let mut ctx = BatchCtx::new(config);
    loop {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(line) => ctx.push_line(&line)?,
            Err(mpsc::RecvTimeoutError::Timeout) => ctx.flush_if_pending()?,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    ctx.finish()
}

struct BatchCtx<'a> {
    config: &'a Config,
    url: String,
    stats: RunStats,
    batch: Vec<SentinelEvent>,
    batch_cursor: Option<String>,
    batch_skipped: u64,
}

impl<'a> BatchCtx<'a> {
    fn new(config: &'a Config) -> Self {
        Self {
            url: config.events_url(),
            config,
            stats: RunStats::default(),
            batch: Vec::new(),
            batch_cursor: None,
            batch_skipped: 0,
        }
    }

    fn push_line(&mut self, line: &str) -> Result<(), Box<dyn std::error::Error>> {
        match parse_journal_line(line, &self.config.host_id, self.config.origin) {
            Some(event) => {
                if let Some(cursor) = cursor_from_line(line) {
                    self.batch_cursor = Some(cursor);
                }
                self.batch.push(event);
                self.stats.emitted += 1;
                if self.batch.len() >= self.config.batch_max {
                    self.flush_if_pending()?;
                }
            }
            None => {
                self.stats.skipped += 1;
                self.batch_skipped += 1;
            }
        }
        Ok(())
    }

    fn flush_if_pending(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        if self.batch.is_empty() {
            return Ok(());
        }
        flush(
            self.config,
            &self.url,
            &mut self.batch,
            &mut self.batch_cursor,
            &mut self.batch_skipped,
            &mut self.stats,
        )
    }

    fn finish(mut self) -> Result<RunStats, Box<dyn std::error::Error>> {
        self.flush_if_pending()?;
        Ok(self.stats)
    }
}

fn cursor_from_line(line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    value
        .get("__CURSOR")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

fn flush(
    config: &Config,
    url: &str,
    batch: &mut Vec<SentinelEvent>,
    batch_cursor: &mut Option<String>,
    batch_skipped: &mut u64,
    stats: &mut RunStats,
) -> Result<(), Box<dyn std::error::Error>> {
    let sent = batch.len();
    let skipped = *batch_skipped;
    let resp = post_batch(url, batch)?;
    eprintln!(
        "sent={} accepted={} duplicates={} skipped={}",
        sent, resp.accepted, resp.duplicates, skipped
    );
    stats.accepted += resp.accepted;
    stats.duplicates += resp.duplicates;
    if let (Some(path), Some(cursor)) = (config.state_file.as_ref(), batch_cursor.as_deref()) {
        persist_cursor(Path::new(path), cursor)?;
    }
    batch.clear();
    *batch_cursor = None;
    *batch_skipped = 0;
    Ok(())
}
