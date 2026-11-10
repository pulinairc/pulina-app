//! What the user is playing right now, from Last.fm's recent tracks.

use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const API: &str = "https://ws.audioscrobbler.com/2.0/";
const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Serialize, PartialEq)]
pub struct Playing {
    pub artist: String,
    pub title: String,
    pub album: String,
    /// The biggest cover Last.fm has, or empty.
    pub image: String,
}

pub async fn now_playing(user: &str, key: &str) -> Result<Option<Playing>, String> {
    let params = [("method", "user.getrecenttracks"), ("user", user), ("api_key", key), ("format", "json"), ("limit", "1")];
    let url = reqwest::Url::parse_with_params(API, &params).map_err(|e| e.to_string())?;
    let res = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Last.fm: {e}"))?;
    let text = res.text().await.map_err(|e| format!("Last.fm: {e}"))?;
    let json: Value = serde_json::from_str(&text).map_err(|e| format!("Last.fm: {e}"))?;
    if let Some(message) = json["message"].as_str() {
        return Err(format!("Last.fm: {message}"));
    }
    Ok(playing(&json))
}

/// The track flagged as playing now. One track can come as an object instead of a list.
fn playing(json: &Value) -> Option<Playing> {
    let tracks = &json["recenttracks"]["track"];
    let list = tracks.as_array().cloned().unwrap_or_else(|| vec![tracks.clone()]);
    let t = list.into_iter().find(|t| t["@attr"]["nowplaying"] == "true")?;
    let text = |v: &Value| v["#text"].as_str().or_else(|| v.as_str()).unwrap_or("").to_string();
    let image = t["image"].as_array().and_then(|all| all.iter().rev().map(text).find(|u| !u.is_empty())).unwrap_or_default();
    Some(Playing { artist: text(&t["artist"]), title: t["name"].as_str().unwrap_or("").to_string(), album: text(&t["album"]), image })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_track_playing_now() {
        let json: Value = serde_json::from_str(
            r##"{"recenttracks":{"track":[
              {"artist":{"#text":"Röyksopp"},"name":"Running to the Sea","album":{"#text":"The Inevitable End"},
               "image":[{"size":"small","#text":"s.jpg"},{"size":"large","#text":"l.jpg"},{"size":"x","#text":""}],"@attr":{"nowplaying":"true"}},
              {"artist":{"#text":"Ladytron"},"name":"Seventeen","album":{"#text":""},"image":[]}]}}"##,
        )
        .unwrap();
        assert_eq!(
            playing(&json),
            Some(Playing {
                artist: "Röyksopp".into(),
                title: "Running to the Sea".into(),
                album: "The Inevitable End".into(),
                image: "l.jpg".into()
            })
        );
        let stopped: Value = serde_json::from_str(r##"{"recenttracks":{"track":{"artist":{"#text":"A"},"name":"B"}}}"##).unwrap();
        assert_eq!(playing(&stopped), None);
    }
}
