use std::collections::BTreeSet;
use std::net::IpAddr;
use std::process::Command;

use crate::netutil::{parse_allowlist, Cidr};

const LOOPBACK_V4: &str = "127.0.0.1";
const LOOPBACK_V6: &str = "::1";

#[derive(Debug, Clone)]
pub struct Policy {
    cidrs: Vec<Cidr>,
    host_ips: BTreeSet<IpAddr>,
}

impl Policy {
    pub fn from_env() -> Self {
        let raw = std::env::var("RESPONSE_ALLOWLIST").unwrap_or_default();
        let (cidrs, invalid) = parse_allowlist(&raw);
        for tok in invalid {
            eprintln!("sentinel-responder: ignoring invalid RESPONSE_ALLOWLIST entry {tok:?}");
        }
        let mut host_ips = discover_host_ips();
        host_ips.insert(LOOPBACK_V4.parse().unwrap());
        host_ips.insert(LOOPBACK_V6.parse().unwrap());
        Self { cidrs, host_ips }
    }

    #[cfg(test)]
    pub fn from_parts(allowlist: &str, host_ips: impl IntoIterator<Item = IpAddr>) -> Self {
        let (cidrs, _) = parse_allowlist(allowlist);
        Self {
            cidrs,
            host_ips: host_ips.into_iter().collect(),
        }
    }

    /// Refusal reason if this IP must never be blocked. Approval cannot bypass this.
    pub fn refuse_reason(&self, ip: IpAddr) -> Option<String> {
        if self.cidrs.iter().any(|c| c.contains(ip)) {
            return Some("target in RESPONSE_ALLOWLIST".into());
        }
        if self.host_ips.contains(&ip) {
            return Some("target is a host address".into());
        }
        None
    }
}

fn discover_host_ips() -> BTreeSet<IpAddr> {
    let mut out = BTreeSet::new();
    if let Some(json) = ip_addr_json() {
        collect_ips_from_iproute_json(&json, &mut out);
    }
    out
}

fn ip_addr_json() -> Option<serde_json::Value> {
    let output = Command::new("ip").args(["-j", "addr"]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

fn collect_ips_from_iproute_json(json: &serde_json::Value, out: &mut BTreeSet<IpAddr>) {
    let Some(ifaces) = json.as_array() else {
        return;
    };
    for iface in ifaces {
        let Some(infos) = iface.get("addr_info").and_then(|v| v.as_array()) else {
            continue;
        };
        for info in infos {
            if let Some(local) = info.get("local").and_then(|v| v.as_str()) {
                if let Ok(ip) = local.parse::<IpAddr>() {
                    out.insert(ip);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::IpAddr;
    use std::str::FromStr;

    fn ip(s: &str) -> IpAddr {
        IpAddr::from_str(s).unwrap()
    }

    #[test]
    fn allowlisted_docnet_is_refused() {
        let policy = Policy::from_parts("192.0.2.0/24", []);
        assert_eq!(
            policy.refuse_reason(ip("192.0.2.10")).as_deref(),
            Some("target in RESPONSE_ALLOWLIST")
        );
    }

    #[test]
    fn blocked_case_docnet_is_allowed_when_not_on_list() {
        let policy = Policy::from_parts("198.51.100.0/24", [ip("203.0.113.10")]);
        assert_eq!(policy.refuse_reason(ip("192.0.2.10")), None);
    }

    #[test]
    fn host_ip_is_refused() {
        let policy = Policy::from_parts("", [ip("203.0.113.10")]);
        assert_eq!(
            policy.refuse_reason(ip("203.0.113.10")).as_deref(),
            Some("target is a host address")
        );
    }

    #[test]
    fn parses_iproute_json_locals() {
        let json = serde_json::json!([
            {
                "ifname": "lo",
                "addr_info": [
                    {"family": "inet", "local": "127.0.0.1"},
                    {"family": "inet6", "local": "::1"}
                ]
            },
            {
                "ifname": "eth0",
                "addr_info": [{"family": "inet", "local": "203.0.113.10"}]
            }
        ]);
        let mut set = BTreeSet::new();
        collect_ips_from_iproute_json(&json, &mut set);
        assert!(set.contains(&ip("127.0.0.1")));
        assert!(set.contains(&ip("203.0.113.10")));
        assert!(set.contains(&ip("::1")));
    }
}
