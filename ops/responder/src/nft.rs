use std::net::IpAddr;
use std::path::Path;
use std::process::{Command, Output, Stdio};

use crate::output::ListEntry;
use crate::timefmt::expires_from_remaining_ms;

const TABLE: &str = "sentinel";
const FAMILY: &str = "inet";
const SET_V4: &str = "blocklist";
const SET_V6: &str = "blocklist6";
const CHAIN: &str = "input";
const COMMENT_V4: &str = "sentinel-block-v4";
const COMMENT_V6: &str = "sentinel-block-v6";

#[derive(Debug)]
pub struct NftError {
    pub message: String,
}

impl NftError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

fn nft_bin() -> Result<&'static str, NftError> {
    for candidate in ["/usr/sbin/nft", "/sbin/nft", "/usr/bin/nft"] {
        if Path::new(candidate).exists() {
            return Ok(candidate);
        }
    }
    Ok("nft")
}

fn run_nft(args: &[&str]) -> Result<Output, NftError> {
    let bin = nft_bin()?;
    let output = Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| NftError::new(format!("failed to execute nft: {e}")))?;
    Ok(output)
}

fn nft_ok(args: &[&str]) -> Result<String, NftError> {
    let output = run_nft(args)?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(NftError::new(format!(
        "nft {} failed: {}",
        args.join(" "),
        stderr.trim()
    )))
}

fn set_for(ip: IpAddr) -> &'static str {
    if ip.is_ipv4() {
        SET_V4
    } else {
        SET_V6
    }
}

pub fn init() -> Result<(), NftError> {
    nft_ok(&["add", "table", FAMILY, TABLE])?;

    let v4 = "{ type ipv4_addr; flags timeout; }";
    match nft_ok(&["add", "set", FAMILY, TABLE, SET_V4, v4]) {
        Ok(_) => {}
        Err(e) if already_exists(&e.message) => {}
        Err(e) => return Err(e),
    }

    let v6 = "{ type ipv6_addr; flags timeout; }";
    match nft_ok(&["add", "set", FAMILY, TABLE, SET_V6, v6]) {
        Ok(_) => {}
        Err(e) if already_exists(&e.message) => {}
        Err(e) => return Err(e),
    }

    let chain = "{ type filter hook input priority filter; policy accept; }";
    match nft_ok(&["add", "chain", FAMILY, TABLE, CHAIN, chain]) {
        Ok(_) => {}
        Err(e) if already_exists(&e.message) => {}
        Err(e) => return Err(e),
    }

    ensure_drop_rule(SET_V4, "ip", COMMENT_V4)?;
    ensure_drop_rule(SET_V6, "ip6", COMMENT_V6)?;
    Ok(())
}

fn already_exists(msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    m.contains("file exists") || m.contains("already exists") || m.contains("exist")
}

fn ensure_drop_rule(set: &str, family_match: &str, comment: &str) -> Result<(), NftError> {
    let listed = match nft_ok(&["list", "chain", FAMILY, TABLE, CHAIN]) {
        Ok(s) => s,
        Err(e) => return Err(e),
    };
    if listed.contains(comment) || listed.contains(&format!("saddr @{set}")) {
        return Ok(());
    }
    nft_ok(&[
        "add",
        "rule",
        FAMILY,
        TABLE,
        CHAIN,
        family_match,
        "saddr",
        &format!("@{set}"),
        "drop",
        "comment",
        comment,
    ])?;
    Ok(())
}

pub fn add_block(ip: IpAddr, ttl_seconds: u64) -> Result<(), NftError> {
    let set = set_for(ip);
    let spec = format!("{{ {ip} timeout {ttl_seconds}s }}");
    match nft_ok(&["add", "element", FAMILY, TABLE, set, &spec]) {
        Ok(_) => Ok(()),
        Err(e) if already_exists(&e.message) => {
            let del = format!("{{ {ip} }}");
            let _ = nft_ok(&["delete", "element", FAMILY, TABLE, set, &del]);
            nft_ok(&["add", "element", FAMILY, TABLE, set, &spec]).map(|_| ())
        }
        Err(e) => Err(e),
    }
}

pub fn remove_block(ip: IpAddr) -> Result<(), NftError> {
    let set = set_for(ip);
    let spec = format!("{{ {ip} }}");
    match nft_ok(&["delete", "element", FAMILY, TABLE, set, &spec]) {
        Ok(_) => Ok(()),
        Err(e) if not_found(&e.message) => Ok(()),
        Err(e) => Err(e),
    }
}

fn not_found(msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    m.contains("no such file")
        || m.contains("not found")
        || m.contains("no such element")
        || m.contains("could not process rule")
}

pub fn list_all() -> Result<Vec<ListEntry>, NftError> {
    let mut entries = Vec::new();
    entries.extend(list_set(SET_V4)?);
    entries.extend(list_set(SET_V6)?);
    Ok(entries)
}

fn list_set(set: &str) -> Result<Vec<ListEntry>, NftError> {
    let stdout = match nft_ok(&["-j", "list", "set", FAMILY, TABLE, set]) {
        Ok(s) => s,
        Err(e) if not_found(&e.message) => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    Ok(parse_set_json(&stdout))
}

pub fn lookup(ip: IpAddr) -> Result<Option<ListEntry>, NftError> {
    let needle = ip.to_string();
    let entries = list_set(set_for(ip))?;
    Ok(entries.into_iter().find(|e| e.target == needle))
}

fn parse_set_json(raw: &str) -> Vec<ListEntry> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let Some(arr) = v.get("nftables").and_then(|x| x.as_array()) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in arr {
        let Some(set) = item.get("set") else {
            continue;
        };
        let Some(elems) = set.get("elem").and_then(|e| e.as_array()) else {
            continue;
        };
        for elem in elems {
            if let Some(entry) = parse_elem(elem) {
                out.push(entry);
            }
        }
    }
    out
}

fn parse_elem(elem: &serde_json::Value) -> Option<ListEntry> {
    if let Some(s) = elem.as_str() {
        return Some(ListEntry {
            target: s.to_string(),
            ttl_seconds: None,
            expires_at: None,
        });
    }
    let obj = elem.as_object()?;
    let inner = obj.get("elem").and_then(|e| e.as_object()).unwrap_or(obj);
    let ip = inner
        .get("val")
        .and_then(json_ip)
        .or_else(|| inner.get("elem").and_then(json_ip))?;
    let remaining_ms = inner
        .get("expires")
        .and_then(|v| v.as_u64())
        .or_else(|| inner.get("timeout").and_then(|v| v.as_u64()));
    let ttl_seconds = remaining_ms.map(|ms| (ms + 999) / 1000);
    let expires_at = remaining_ms.map(expires_from_remaining_ms);
    Some(ListEntry {
        target: ip,
        ttl_seconds,
        expires_at,
    })
}

fn json_ip(v: &serde_json::Value) -> Option<String> {
    if let Some(s) = v.as_str() {
        return Some(s.to_string());
    }
    if let Some(n) = v.as_u64() {
        let b = n.to_be_bytes();
        if n <= u32::MAX as u64 {
            return Some(std::net::Ipv4Addr::new(b[4], b[5], b[6], b[7]).to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nft_json_elements() {
        let raw = r#"{
          "nftables": [
            {"metainfo": {}},
            {
              "set": {
                "family": "inet",
                "name": "blocklist",
                "table": "sentinel",
                "elem": [
                  "192.0.2.1",
                  {"elem": {"val": "192.0.2.10", "expires": 5000, "timeout": 600000}}
                ]
              }
            }
          ]
        }"#;
        let entries = parse_set_json(raw);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].target, "192.0.2.1");
        assert_eq!(entries[1].target, "192.0.2.10");
        assert_eq!(entries[1].ttl_seconds, Some(5));
        assert!(entries[1].expires_at.as_ref().unwrap().ends_with('Z'));
    }
}
