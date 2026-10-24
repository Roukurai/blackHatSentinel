//! Live nftables round-trip. Enable with `--features nft-integration`.
//! Automatically skipped when not Linux or not running as root.
//!
//!   cd ops/responder && cargo test --features nft-integration
//!
//! Uses documentation address 192.0.2.99 (TEST-NET-1).

use std::process::{Command, Stdio};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_sentinel-responder")
}

struct Run {
    code: i32,
    json: serde_json::Value,
}

fn invoke(args: &[&str]) -> Run {
    let output = Command::new(bin())
        .args(args)
        .env("RESPONSE_ALLOWLIST", "198.51.100.0/24")
        .env("RESPONSE_BLOCK_TTL_SECONDS", "60")
        .stdin(Stdio::null())
        .output()
        .expect("spawn sentinel-responder");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().last().unwrap_or("").trim().to_string();
    let json: serde_json::Value =
        serde_json::from_str(&line).unwrap_or_else(|_| panic!("expected JSON stdout, got {line:?}"));
    Run {
        code: output.status.code().unwrap_or(1),
        json,
    }
}

fn skip_nft() -> bool {
    if !cfg!(feature = "nft-integration") {
        eprintln!("skip nft integration: enable --features nft-integration");
        return true;
    }
    if !cfg!(target_os = "linux") {
        eprintln!("skip nft integration: not Linux");
        return true;
    }
    let root = Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim() == "0")
        .unwrap_or(false);
    if !root {
        eprintln!("skip nft integration: not root");
        return true;
    }
    false
}

#[test]
fn invalid_ip_exit_2_from_binary() {
    let output = Command::new(bin())
        .args(["block", "nope"])
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(json["status"], "failed");
    assert_eq!(json["kind"], "block_ip");
}

#[test]
fn policy_reject_does_not_need_nft() {
    let output = Command::new(bin())
        .args(["block", "198.51.100.20"])
        .env("RESPONSE_ALLOWLIST", "198.51.100.0/24")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(3));
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).expect("json");
    assert_eq!(json["action"], "block");
    assert_eq!(json["kind"], "block_ip");
    assert_eq!(json["target"], "198.51.100.20");
    assert_eq!(json["status"], "rejected_by_policy");
    assert_eq!(json["policy_reason"], "target in RESPONSE_ALLOWLIST");
}

#[test]
fn block_verify_unblock_verify() {
    if skip_nft() {
        return;
    }
    let ip = "192.0.2.99";

    let init = invoke(&["init"]);
    assert_eq!(init.code, 0, "init: {:?}", init.json);
    assert_eq!(init.json["status"], "applied");
    assert_eq!(init.json["action"], "init");

    let blocked = invoke(&["block", ip]);
    assert_eq!(blocked.code, 0, "block: {:?}", blocked.json);
    assert_eq!(blocked.json["action"], "block");
    assert_eq!(blocked.json["kind"], "block_ip");
    assert_eq!(blocked.json["target"], ip);
    assert_eq!(blocked.json["status"], "applied");
    assert_eq!(blocked.json["ttl_seconds"], 60);
    assert!(blocked.json["expires_at"].as_str().unwrap().ends_with('Z'));
    assert!(blocked.json["applied_at"].as_str().unwrap().ends_with('Z'));

    let present = invoke(&["verify", ip]);
    assert_eq!(present.code, 0, "verify present: {:?}", present.json);
    assert_eq!(present.json["status"], "verified");
    assert_eq!(present.json["target"], ip);

    let listed = invoke(&["list"]);
    assert_eq!(listed.code, 0, "list: {:?}", listed.json);
    let entries = listed.json["entries"].as_array().expect("entries");
    assert!(
        entries.iter().any(|e| e["target"] == ip),
        "list missing {ip}: {entries:?}"
    );

    let undone = invoke(&["unblock", ip]);
    assert_eq!(undone.code, 0, "unblock: {:?}", undone.json);
    assert_eq!(undone.json["status"], "rolled_back");

    let absent = invoke(&["verify", ip]);
    assert_eq!(absent.code, 1, "verify absent: {:?}", absent.json);
    assert_eq!(absent.json["status"], "expired");
}
