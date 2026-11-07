//! What the Lobby app and lobby-server say to each other over a WebSocket, as JSON.
//!
//! The app sends `hello` with the token first. The server answers `welcome` with the
//! current state, then streams events. Requests carry an `id` that the reply repeats.

use crate::hub::{Event, Snapshot};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    Hello { token: String },
    History { id: u64, net: String, buffer: String, before: Option<i64> },
    Recent { id: u64 },
    Send { id: u64, net: String, buffer: String, text: String },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    Welcome { snapshot: Snapshot },
    Event { event: Event },
    Reply { id: u64, data: Option<serde_json::Value>, error: Option<String> },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Line;

    #[test]
    fn round_trips_as_json() {
        let msg = ServerMsg::Event { event: Event::Line(Line { text: "hei".into(), ..Default::default() }) };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"event""#));
        let back: ServerMsg = serde_json::from_str(&json).unwrap();
        assert!(matches!(back, ServerMsg::Event { event: Event::Line(l) } if l.text == "hei"));

        let hello: ClientMsg = serde_json::from_str(r#"{"type":"hello","token":"t"}"#).unwrap();
        assert!(matches!(hello, ClientMsg::Hello { token } if token == "t"));
    }
}
