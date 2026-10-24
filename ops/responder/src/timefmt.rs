use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// UTC ISO-8601 with milliseconds, e.g. `2026-10-24T18:00:00.000Z`.
pub fn iso8601(t: SystemTime) -> String {
    let dur = t.duration_since(UNIX_EPOCH).unwrap_or(Duration::ZERO);
    let secs = dur.as_secs();
    let millis = dur.subsec_millis();
    let (year, month, day) = civil_from_unix_days((secs / 86400) as i64);
    let tod = (secs % 86400) as u32;
    let hour = tod / 3600;
    let min = (tod % 3600) / 60;
    let sec = tod % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}.{millis:03}Z")
}

pub fn now_iso() -> String {
    iso8601(SystemTime::now())
}

pub fn expires_iso(ttl_seconds: u64) -> String {
    iso8601(SystemTime::now() + Duration::from_secs(ttl_seconds))
}

pub fn expires_from_remaining_ms(remaining_ms: u64) -> String {
    iso8601(SystemTime::now() + Duration::from_millis(remaining_ms))
}

/// Howard Hinnant's civil-from-days; `days` is days since Unix epoch.
fn civil_from_unix_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = y + if m <= 2 { 1 } else { 0 };
    (y as i32, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_epoch_formats() {
        assert_eq!(iso8601(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
    }

    #[test]
    fn known_unix_timestamp() {
        let t = UNIX_EPOCH + Duration::from_secs(1_698_163_200);
        assert_eq!(iso8601(t), "2023-10-24T16:00:00.000Z");
    }
}
