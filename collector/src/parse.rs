use sha2::{Digest, Sha256};

use crate::event::{EventType, Origin, SentinelEvent};

const USERNAME_MAX_CHARS: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineOutcome {
    Event,
    Skipped,
}

pub fn parse_journal_line(line: &str, host_id: &str, origin: Origin) -> Option<SentinelEvent> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let obj = value.as_object()?;
    let message = obj.get("MESSAGE")?.as_str()?;
    let cursor = obj.get("__CURSOR")?.as_str()?;
    let realtime_us = parse_realtime(obj.get("__REALTIME_TIMESTAMP")?)?;
    let (event_type, username, source_ip, source_port) = parse_message(message)?;
    Some(SentinelEvent {
        event_id: event_id_from_cursor(cursor),
        host_id: host_id.to_string(),
        timestamp: iso8601_utc_ms(realtime_us),
        event_type,
        username: Some(username),
        source_ip: Some(source_ip),
        source_port: Some(source_port),
        raw_message: message.to_string(),
        origin,
    })
}

pub fn classify_line(line: &str, host_id: &str, origin: Origin) -> LineOutcome {
    if parse_journal_line(line, host_id, origin).is_some() {
        LineOutcome::Event
    } else {
        LineOutcome::Skipped
    }
}

pub fn parse_message(message: &str) -> Option<(EventType, String, String, u16)> {
    if let Some((user, ip, port)) = parse_invalid_user(message) {
        return Some((EventType::SshInvalidUser, user, ip, port));
    }
    if let Some((user, ip, port)) = parse_preauth_disconnect(message) {
        return Some((EventType::SshPreauthDisconnect, user, ip, port));
    }
    if message.starts_with("Connection closed by invalid user ") {
        return None;
    }
    if let Some((user, ip, port)) = parse_failed_password(message) {
        return Some((EventType::SshFailedPassword, user, ip, port));
    }
    if let Some((user, ip, port)) = parse_accepted(message) {
        return Some((EventType::SshSuccess, user, ip, port));
    }
    None
}

fn parse_invalid_user(message: &str) -> Option<(String, String, u16)> {
    const PREFIX: &str = "Invalid user ";
    if !message.starts_with(PREFIX) {
        return None;
    }
    let (ip, port, ip_at) = parse_ip_port_from_end(message)?;
    let from_at = strip_from_before_ip(message, ip_at)?;
    if from_at < PREFIX.len() {
        return None;
    }
    let username = truncate_username(&message[PREFIX.len()..from_at]);
    Some((username, ip, port))
}

fn parse_preauth_disconnect(message: &str) -> Option<(String, String, u16)> {
    const PREFIX: &str = "Connection closed by authenticating user ";
    if !message.starts_with(PREFIX) {
        return None;
    }
    let (ip, port, ip_at) = parse_ip_port_from_end(message)?;
    if ip_at == 0 || message.as_bytes().get(ip_at - 1) != Some(&b' ') {
        return None;
    }
    let username = truncate_username(&message[PREFIX.len()..ip_at - 1]);
    Some((username, ip, port))
}

fn parse_failed_password(message: &str) -> Option<(String, String, u16)> {
    const PREFIX: &str = "Failed password for ";
    if !message.starts_with(PREFIX) {
        return None;
    }
    let (ip, port, ip_at) = parse_ip_port_from_end(message)?;
    let from_at = strip_from_before_ip(message, ip_at)?;
    if from_at < PREFIX.len() {
        return None;
    }
    let mut user_part = &message[PREFIX.len()..from_at];
    if let Some(rest) = user_part.strip_prefix("invalid user ") {
        user_part = rest;
    }
    Some((truncate_username(user_part), ip, port))
}

fn parse_accepted(message: &str) -> Option<(String, String, u16)> {
    const PREFIX: &str = "Accepted ";
    if !message.starts_with(PREFIX) {
        return None;
    }
    let (ip, port, ip_at) = parse_ip_port_from_end(message)?;
    let from_at = strip_from_before_ip(message, ip_at)?;
    let head = &message[..from_at];
    let for_at = head.rfind(" for ")?;
    if for_at < PREFIX.len() {
        return None;
    }
    let method = &head[PREFIX.len()..for_at];
    if method.is_empty() || method.contains(' ') {
        return None;
    }
    let username = truncate_username(&head[for_at + " for ".len()..]);
    Some((username, ip, port))
}

fn strip_from_before_ip(message: &str, ip_at: usize) -> Option<usize> {
    const FROM: &str = " from ";
    if ip_at < FROM.len() {
        return None;
    }
    let from_at = ip_at - FROM.len();
    if &message[from_at..ip_at] != FROM {
        return None;
    }
    Some(from_at)
}

/// IP and port are taken from the end of the line so usernames may be empty or contain spaces.
fn parse_ip_port_from_end(message: &str) -> Option<(String, u16, usize)> {
    const PORT: &str = " port ";
    let port_at = message.rfind(PORT)?;
    let after = &message[port_at + PORT.len()..];
    let digits = after
        .char_indices()
        .take_while(|(_, c)| c.is_ascii_digit())
        .last()
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(0);
    if digits == 0 {
        return None;
    }
    let port: u16 = after[..digits].parse().ok()?;
    let before = &message[..port_at];
    let ip_at = before.rfind(' ').map(|i| i + 1).unwrap_or(0);
    let ip = &before[ip_at..];
    if ip.is_empty() {
        return None;
    }
    Some((ip.to_string(), port, ip_at))
}

fn truncate_username(username: &str) -> String {
    if username.chars().count() <= USERNAME_MAX_CHARS {
        username.to_string()
    } else {
        username.chars().take(USERNAME_MAX_CHARS).collect()
    }
}

pub fn event_id_from_cursor(cursor: &str) -> String {
    format!("{:x}", Sha256::digest(cursor.as_bytes()))
}

fn parse_realtime(value: &serde_json::Value) -> Option<u64> {
    match value {
        serde_json::Value::String(s) => s.parse().ok(),
        serde_json::Value::Number(n) => n
            .as_u64()
            .or_else(|| n.as_i64().and_then(|i| u64::try_from(i).ok())),
        _ => None,
    }
}

/// ISO-8601 UTC with milliseconds, from journald `__REALTIME_TIMESTAMP` (µs since epoch).
pub fn iso8601_utc_ms(realtime_us: u64) -> String {
    let millis = realtime_us / 1000;
    let secs = millis / 1000;
    let ms = millis % 1000;
    let days = secs / 86_400;
    let sod = secs % 86_400;
    let hour = sod / 3_600;
    let min = (sod % 3_600) / 60;
    let sec = sod % 60;
    let (year, month, day) = civil_from_unix_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}.{ms:03}Z")
}

/// Unix epoch day count → Gregorian Y-M-D (Howard Hinnant, public domain).
fn civil_from_unix_days(days: u64) -> (i32, u32, u32) {
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::EventType;

    fn parsed(message: &str) -> (EventType, String, String, u16) {
        parse_message(message).expect("expected a Sentinel event")
    }

    #[test]
    fn invalid_user_user_from_192_0_2_50() {
        let (kind, user, ip, port) =
            parsed("Invalid user user from 192.0.2.50 port 21000");
        assert_eq!(kind, EventType::SshInvalidUser);
        assert_eq!(user, "user");
        assert_eq!(ip, "192.0.2.50");
        assert_eq!(port, 21000);
    }

    #[test]
    fn invalid_user_admin_from_192_0_2_50() {
        let (kind, user, ip, _) = parsed("Invalid user admin from 192.0.2.50 port 22000");
        assert_eq!(kind, EventType::SshInvalidUser);
        assert_eq!(user, "admin");
        assert_eq!(ip, "192.0.2.50");
    }

    #[test]
    fn empty_username_must_not_panic() {
        let result = std::panic::catch_unwind(|| {
            parse_message("Invalid user  from 192.0.2.50 port 23000")
        });
        let (kind, user, ip, port) = result
            .expect("empty username must not panic")
            .expect("empty username is a valid ssh_invalid_user");
        assert_eq!(kind, EventType::SshInvalidUser);
        assert_eq!(user, "");
        assert_eq!(ip, "192.0.2.50");
        assert_eq!(port, 23000);
    }

    #[test]
    fn preauth_disconnect_authenticating_user_root() {
        let (kind, user, ip, port) = parsed(
            "Connection closed by authenticating user root 198.51.100.7 port 40001 [preauth]",
        );
        assert_eq!(kind, EventType::SshPreauthDisconnect);
        assert_eq!(user, "root");
        assert_eq!(ip, "198.51.100.7");
        assert_eq!(port, 40001);
    }

    #[test]
    fn skip_connection_closed_probe_no_user() {
        assert_eq!(
            parse_message("Connection closed by 198.51.100.7 port 40002"),
            None
        );
    }

    #[test]
    fn skip_server_listening_noise() {
        assert_eq!(
            parse_message("Server listening on 0.0.0.0 port 22."),
            None
        );
    }

    #[test]
    fn invalid_user_crypto_from_203_0_113_9() {
        let (kind, user, ip, _) = parsed("Invalid user sol from 203.0.113.9 port 30000");
        assert_eq!(kind, EventType::SshInvalidUser);
        assert_eq!(user, "sol");
        assert_eq!(ip, "203.0.113.9");
    }

    #[test]
    fn failed_password_for_demo() {
        let (kind, user, ip, port) =
            parsed("Failed password for demo from 203.0.113.77 port 50000 ssh2");
        assert_eq!(kind, EventType::SshFailedPassword);
        assert_eq!(user, "demo");
        assert_eq!(ip, "203.0.113.77");
        assert_eq!(port, 50000);
    }

    #[test]
    fn accepted_password_for_demo() {
        let (kind, user, ip, _) =
            parsed("Accepted password for demo from 203.0.113.77 port 50010 ssh2");
        assert_eq!(kind, EventType::SshSuccess);
        assert_eq!(user, "demo");
        assert_eq!(ip, "203.0.113.77");
    }

    #[test]
    fn accepted_publickey_for_rou() {
        let (kind, user, ip, port) = parsed(
            "Accepted publickey for rou from 203.0.113.200 port 59999 ssh2: ED25519 SHA256:EXAMPLEFINGERPRINTvalueForTestsOnly000000000",
        );
        assert_eq!(kind, EventType::SshSuccess);
        assert_eq!(user, "rou");
        assert_eq!(ip, "203.0.113.200");
        assert_eq!(port, 59999);
    }

    #[test]
    fn contract_edge_cases() {
        assert_eq!(
            parse_message(
                "Connection closed by invalid user admin from 198.51.100.7 port 1 [preauth]"
            ),
            None
        );

        let (kind, user, ip, _) =
            parsed("Invalid user foo bar from 192.0.2.50 port 9");
        assert_eq!(kind, EventType::SshInvalidUser);
        assert_eq!(user, "foo bar");
        assert_eq!(ip, "192.0.2.50");

        let long = "x".repeat(80);
        let msg = format!("Invalid user {long} from 192.0.2.50 port 1");
        let (_, user, _, _) = parsed(&msg);
        assert_eq!(user.len(), 64);

        let (kind, user, _, _) =
            parsed("Failed password for invalid user demo from 203.0.113.77 port 1 ssh2");
        assert_eq!(kind, EventType::SshFailedPassword);
        assert_eq!(user, "demo");
    }

    #[test]
    fn timestamp_and_event_id_from_journal_fields() {
        let cursor = "s=abc;i=1;b=1;m=1;t=1;x=1";
        // 2026-10-24T15:51:15Z = 1792857075 seconds.
        assert_eq!(iso8601_utc_ms(1_792_857_075_000_000), "2026-10-24T15:51:15.000Z");
        assert_eq!(
            iso8601_utc_ms(1_792_857_075_123_000),
            "2026-10-24T15:51:15.123Z"
        );

        let id = event_id_from_cursor(cursor);
        assert_eq!(id.len(), 64);
        assert!(id.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')));
        assert_eq!(id, event_id_from_cursor(cursor));
    }

    #[test]
    fn host_id_comes_from_config_not_hostname() {
        let line = r#"{"MESSAGE":"Invalid user user from 192.0.2.50 port 21000","__CURSOR":"s=abc;i=1","__REALTIME_TIMESTAMP":"1792857075000000","_HOSTNAME":"vmi3694090"}"#;
        let event = parse_journal_line(line, "ubuntu-01", Origin::Replay).unwrap();
        assert_eq!(event.host_id, "ubuntu-01");
        assert_eq!(event.origin, Origin::Replay);
        assert_eq!(event.event_id, event_id_from_cursor("s=abc;i=1"));
        assert_eq!(event.timestamp, "2026-10-24T15:51:15.000Z");
        assert!(!event.raw_message.contains("vmi3694090"));
    }
}
