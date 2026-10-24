mod netutil;
mod nft;
mod output;
mod policy;
mod timefmt;

use std::env;
use std::net::IpAddr;

use netutil::parse_ip;
use output::{
    RunnerResult, EXIT_BAD_ARGS, EXIT_FAIL, EXIT_OK, EXIT_POLICY, STATUS_APPLIED, STATUS_EXPIRED,
    STATUS_FAILED, STATUS_REJECTED, STATUS_ROLLED_BACK, STATUS_VERIFIED,
};
use policy::Policy;
use timefmt::{expires_iso, now_iso};

const DEFAULT_TTL: u64 = 600;

pub fn run<I, S>(args: I) -> i32
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args: Vec<String> = args.into_iter().map(|s| s.as_ref().to_string()).collect();
    match args.first().map(String::as_str) {
        Some("block") => cmd_block(&args[1..]),
        Some("unblock") => cmd_unblock(&args[1..]),
        Some("verify") => cmd_verify(&args[1..]),
        Some("list") => cmd_list(&args[1..]),
        Some("init") => cmd_init(&args[1..]),
        Some(other) => {
            fail_args(
                other,
                None,
                format!("unknown subcommand {other:?}; expected block|unblock|verify|list|init"),
            )
        }
        None => fail_args(
            "help",
            None,
            "usage: sentinel-responder <block|unblock|verify|list|init> [IP]".into(),
        ),
    }
}

fn ttl_from_env() -> u64 {
    env::var("RESPONSE_BLOCK_TTL_SECONDS")
        .ok()
        .and_then(|s| s.parse().ok())
        .filter(|&n| n > 0)
        .unwrap_or(DEFAULT_TTL)
}

fn require_ip(action: &str, args: &[String]) -> Result<IpAddr, i32> {
    let Some(raw) = args.first() else {
        return Err(fail_args(
            action,
            None,
            format!("{action} requires an IP argument"),
        ));
    };
    if args.len() != 1 {
        return Err(fail_args(
            action,
            Some(raw.clone()),
            format!("{action} takes exactly one IP argument"),
        ));
    }
    match parse_ip(raw) {
        Ok(ip) => Ok(ip),
        Err(_) => Err(fail_args(
            action,
            Some(raw.clone()),
            format!("invalid IP: {raw}"),
        )),
    }
}

fn fail_args(action: &str, target: Option<String>, msg: String) -> i32 {
    eprintln!("sentinel-responder: {msg}");
    let mut r = RunnerResult::new(action, target, STATUS_FAILED);
    r.policy_reason = None;
    r.emit();
    EXIT_BAD_ARGS
}

fn fail_exec(action: &str, target: Option<String>, msg: String) -> i32 {
    eprintln!("sentinel-responder: {msg}");
    RunnerResult::new(action, target, STATUS_FAILED).emit();
    EXIT_FAIL
}

fn cmd_init(args: &[String]) -> i32 {
    if !args.is_empty() {
        return fail_args("init", None, "init takes no arguments".into());
    }
    match nft::init() {
        Ok(()) => {
            RunnerResult::new("init", None, STATUS_APPLIED).emit();
            EXIT_OK
        }
        Err(e) => fail_exec("init", None, e.message),
    }
}

fn cmd_block(args: &[String]) -> i32 {
    let ip = match require_ip("block", args) {
        Ok(ip) => ip,
        Err(code) => return code,
    };
    let target = ip.to_string();
    let policy = Policy::from_env();
    if let Some(reason) = policy.refuse_reason(ip) {
        let mut r = RunnerResult::new("block", Some(target), STATUS_REJECTED);
        r.policy_reason = Some(reason);
        r.emit();
        return EXIT_POLICY;
    }
    let ttl = ttl_from_env();
    match nft::add_block(ip, ttl) {
        Ok(()) => {
            let mut r = RunnerResult::new("block", Some(target), STATUS_APPLIED);
            r.ttl_seconds = Some(ttl);
            r.expires_at = Some(expires_iso(ttl));
            r.applied_at = Some(now_iso());
            r.emit();
            EXIT_OK
        }
        Err(e) => fail_exec("block", Some(target), e.message),
    }
}

fn cmd_unblock(args: &[String]) -> i32 {
    let ip = match require_ip("unblock", args) {
        Ok(ip) => ip,
        Err(code) => return code,
    };
    let target = ip.to_string();
    match nft::remove_block(ip) {
        Ok(()) => {
            RunnerResult::new("unblock", Some(target), STATUS_ROLLED_BACK).emit();
            EXIT_OK
        }
        Err(e) => fail_exec("unblock", Some(target), e.message),
    }
}

fn cmd_verify(args: &[String]) -> i32 {
    let ip = match require_ip("verify", args) {
        Ok(ip) => ip,
        Err(code) => return code,
    };
    let target = ip.to_string();
    match nft::lookup(ip) {
        Ok(Some(entry)) => {
            let mut r = RunnerResult::new("verify", Some(target), STATUS_VERIFIED);
            r.ttl_seconds = entry.ttl_seconds;
            r.expires_at = entry.expires_at;
            r.emit();
            EXIT_OK
        }
        Ok(None) => {
            RunnerResult::new("verify", Some(target), STATUS_EXPIRED).emit();
            EXIT_FAIL
        }
        Err(e) => fail_exec("verify", Some(target), e.message),
    }
}

fn cmd_list(args: &[String]) -> i32 {
    if !args.is_empty() {
        return fail_args("list", None, "list takes no arguments".into());
    }
    match nft::list_all() {
        Ok(entries) => {
            let mut r = RunnerResult::new("list", None, STATUS_VERIFIED);
            r.entries = Some(entries);
            r.emit();
            EXIT_OK
        }
        Err(e) => fail_exec("list", None, e.message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::netutil::parse_ip;
    use crate::policy::Policy;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn unknown_subcommand_is_exit_2() {
        let code = run(["wat"]);
        assert_eq!(code, EXIT_BAD_ARGS);
    }

    #[test]
    fn invalid_ip_is_exit_2_before_nft() {
        let code = run(["block", "not-an-ip"]);
        assert_eq!(code, EXIT_BAD_ARGS);
        let code = run(["block", "192.0.2.1;touch /tmp/pwn"]);
        assert_eq!(code, EXIT_BAD_ARGS);
        let code = run(["verify", "1.2.3"]);
        assert_eq!(code, EXIT_BAD_ARGS);
    }

    #[test]
    fn docnet_allowlisted_case() {
        let policy = Policy::from_parts("192.0.2.0/24", []);
        let ip = parse_ip("192.0.2.10").unwrap();
        assert_eq!(
            policy.refuse_reason(ip).as_deref(),
            Some("target in RESPONSE_ALLOWLIST")
        );
    }

    #[test]
    fn docnet_blocked_case() {
        let policy = Policy::from_parts("", []);
        let ip = parse_ip("192.0.2.10").unwrap();
        assert_eq!(policy.refuse_reason(ip), None);
    }

    #[test]
    fn allowlisted_block_exits_3_without_nft() {
        let _g = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        env::set_var("RESPONSE_ALLOWLIST", "192.0.2.0/24");
        let code = run(["block", "192.0.2.10"]);
        env::remove_var("RESPONSE_ALLOWLIST");
        assert_eq!(code, EXIT_POLICY);
    }
}
