use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    SshInvalidUser,
    SshPreauthDisconnect,
    SshFailedPassword,
    SshSuccess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    Live,
    Replay,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SentinelEvent {
    pub event_id: String,
    pub host_id: String,
    pub timestamp: String,
    #[serde(rename = "type")]
    pub event_type: EventType,
    pub username: Option<String>,
    pub source_ip: Option<String>,
    pub source_port: Option<u16>,
    pub raw_message: String,
    pub origin: Origin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventsResponse {
    pub accepted: u64,
    pub duplicates: u64,
}
