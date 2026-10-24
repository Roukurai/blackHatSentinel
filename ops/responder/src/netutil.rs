use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::str::FromStr;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cidr {
    addr: IpAddr,
    prefix: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseIpError {
    InvalidIp,
    InvalidCidr,
}

impl Cidr {
    pub fn parse(spec: &str) -> Result<Self, ParseIpError> {
        let spec = spec.trim();
        if spec.is_empty() {
            return Err(ParseIpError::InvalidCidr);
        }
        let (addr_s, prefix_s) = spec
            .split_once('/')
            .ok_or(ParseIpError::InvalidCidr)?;
        let addr = IpAddr::from_str(addr_s.trim()).map_err(|_| ParseIpError::InvalidCidr)?;
        let prefix: u8 = prefix_s
            .trim()
            .parse()
            .map_err(|_| ParseIpError::InvalidCidr)?;
        let max = match addr {
            IpAddr::V4(_) => 32,
            IpAddr::V6(_) => 128,
        };
        if prefix > max {
            return Err(ParseIpError::InvalidCidr);
        }
        Ok(Self { addr, prefix })
    }

    pub fn contains(&self, ip: IpAddr) -> bool {
        match (self.addr, ip) {
            (IpAddr::V4(net), IpAddr::V4(addr)) => {
                ipv4_masked(net, self.prefix) == ipv4_masked(addr, self.prefix)
            }
            (IpAddr::V6(net), IpAddr::V6(addr)) => {
                ipv6_masked(net, self.prefix) == ipv6_masked(addr, self.prefix)
            }
            _ => false,
        }
    }
}

fn ipv4_masked(addr: Ipv4Addr, prefix: u8) -> u32 {
    let bits = u32::from(addr);
    if prefix == 0 {
        0
    } else {
        let shift = 32 - prefix;
        (bits >> shift) << shift
    }
}

fn ipv6_masked(addr: Ipv6Addr, prefix: u8) -> u128 {
    let bits = u128::from(addr);
    if prefix == 0 {
        0
    } else {
        let shift = 128 - prefix;
        (bits >> shift) << shift
    }
}

pub fn parse_ip(raw: &str) -> Result<IpAddr, ParseIpError> {
    IpAddr::from_str(raw.trim()).map_err(|_| ParseIpError::InvalidIp)
}

pub fn parse_allowlist(raw: &str) -> (Vec<Cidr>, Vec<String>) {
    let mut cidrs = Vec::new();
    let mut invalid = Vec::new();
    for token in raw.split(',') {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        match Cidr::parse(token) {
            Ok(c) => cidrs.push(c),
            Err(_) => invalid.push(token.to_string()),
        }
    }
    (cidrs, invalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ip_accepts_v4_and_v6() {
        assert_eq!(
            parse_ip("192.0.2.10").unwrap(),
            IpAddr::from_str("192.0.2.10").unwrap()
        );
        assert!(parse_ip("2001:db8::1").is_ok());
    }

    #[test]
    fn parse_ip_rejects_junk() {
        for bad in [
            "",
            "localhost",
            "1.2.3",
            "192.0.2.1/32",
            "192.0.2.1;id",
            "192.0.2.1 rm -rf",
            "not-an-ip",
            "::gg",
        ] {
            assert_eq!(parse_ip(bad), Err(ParseIpError::InvalidIp), "{bad}");
        }
    }

    #[test]
    fn docnet_cidr_contains() {
        let cidr = Cidr::parse("192.0.2.0/24").unwrap();
        assert!(cidr.contains(parse_ip("192.0.2.10").unwrap()));
        assert!(cidr.contains(parse_ip("192.0.2.255").unwrap()));
        assert!(!cidr.contains(parse_ip("198.51.100.1").unwrap()));
        assert!(!cidr.contains(parse_ip("192.0.3.1").unwrap()));
        assert!(!cidr.contains(parse_ip("2001:db8::1").unwrap()));
    }

    #[test]
    fn allowlist_splits_and_skips_garbage() {
        let (cidrs, invalid) = parse_allowlist("192.0.2.0/24, nope, 2001:db8::/32,");
        assert_eq!(cidrs.len(), 2);
        assert_eq!(invalid, vec!["nope".to_string()]);
    }
}
