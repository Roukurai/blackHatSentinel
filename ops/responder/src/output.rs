use serde::Serialize;

/// Runner stdout JSON. Aligns with CONTRACT §8 `ResponseAction` fields Kevin/Jordi bind to:
/// `target`, `status`, `ttl_seconds`, `expires_at`, `policy_reason`, plus `kind: "block_ip"`.
/// `action` is the subcommand that produced this line. `applied_at` is set on successful block.
/// `entries` is only present for `list`.
#[derive(Debug, Clone, Serialize)]
pub struct RunnerResult {
    pub action: String,
    pub kind: &'static str,
    pub target: Option<String>,
    pub status: &'static str,
    pub ttl_seconds: Option<u64>,
    pub expires_at: Option<String>,
    pub applied_at: Option<String>,
    pub policy_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<ListEntry>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ListEntry {
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
}

impl RunnerResult {
    pub fn new(action: &str, target: Option<String>, status: &'static str) -> Self {
        Self {
            action: action.to_string(),
            kind: "block_ip",
            target,
            status,
            ttl_seconds: None,
            expires_at: None,
            applied_at: None,
            policy_reason: None,
            entries: None,
        }
    }

    pub fn emit(&self) {
        println!("{}", serde_json::to_string(self).expect("serialize"));
    }
}

pub const STATUS_APPLIED: &str = "applied";
pub const STATUS_VERIFIED: &str = "verified";
pub const STATUS_EXPIRED: &str = "expired";
pub const STATUS_ROLLED_BACK: &str = "rolled_back";
pub const STATUS_REJECTED: &str = "rejected_by_policy";
pub const STATUS_FAILED: &str = "failed";

pub const EXIT_OK: i32 = 0;
pub const EXIT_FAIL: i32 = 1;
pub const EXIT_BAD_ARGS: i32 = 2;
pub const EXIT_POLICY: i32 = 3;
