//! Link previews: images by content type, pages by their Open Graph tags.

use regex::Regex;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use std::sync::LazyLock;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(6);
const MAX_HTML_BYTES: usize = 512 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 (compatible; Lobby IRC client; link preview)";

static META: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<meta\s[^>]*>").unwrap());
static ATTR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?is)([a-z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap());
static TITLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<title[^>]*>(.*?)</title>").unwrap());

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct Preview {
    pub kind: String,
    pub url: String,
    pub title: String,
    pub description: String,
    pub image: String,
    pub site: String,
}

fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => !(v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast()),
        IpAddr::V6(v6) => {
            let local = (v6.segments()[0] & 0xfe00) == 0xfc00 || (v6.segments()[0] & 0xffc0) == 0xfe80;
            !(v6.is_loopback() || v6.is_unspecified() || local)
        }
    }
}

/// Refuse hosts that resolve to the local network, so a pasted link cannot probe it.
// ponytail: checked before the request only; a redirect to a private address is not re-checked.
async fn host_is_public(url: &Url) -> bool {
    let (Some(host), Some(port)) = (url.host_str(), url.port_or_known_default()) else { return false };
    match tokio::net::lookup_host((host, port)).await {
        Ok(addrs) => {
            let addrs: Vec<_> = addrs.collect();
            !addrs.is_empty() && addrs.iter().all(|a| is_public(a.ip()))
        }
        Err(_) => false,
    }
}

pub async fn fetch(raw: &str) -> Option<Preview> {
    let url = Url::parse(raw).ok()?;
    if !matches!(url.scheme(), "http" | "https") || !host_is_public(&url).await {
        return None;
    }

    let client = reqwest::Client::builder().timeout(TIMEOUT).user_agent(USER_AGENT).build().ok()?;
    let mut res = client.get(url.clone()).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }

    let content_type = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
    let site = url.host_str().unwrap_or("").trim_start_matches("www.").to_string();

    if content_type.starts_with("image/") {
        return Some(Preview { kind: "image".into(), url: raw.into(), image: raw.into(), site, ..Default::default() });
    }
    if !content_type.contains("html") {
        return None;
    }

    let mut body = Vec::new();
    while let Ok(Some(chunk)) = res.chunk().await {
        body.extend_from_slice(&chunk);
        if body.len() >= MAX_HTML_BYTES {
            break;
        }
    }

    let mut preview = parse(&String::from_utf8_lossy(&body), res.url());
    if preview.title.is_empty() && preview.image.is_empty() {
        return None;
    }
    preview.url = raw.into();
    if preview.site.is_empty() {
        preview.site = site;
    }
    Some(preview)
}

fn decode_entities(s: &str) -> String {
    s.replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .trim()
        .to_string()
}

pub fn parse(html: &str, base: &Url) -> Preview {
    let mut p = Preview { kind: "page".into(), ..Default::default() };
    let mut fallback_title = String::new();
    let mut fallback_description = String::new();

    for tag in META.find_iter(html) {
        let mut key = String::new();
        let mut content = String::new();
        for cap in ATTR.captures_iter(tag.as_str()) {
            let name = cap[1].to_lowercase();
            let value = cap.get(2).or(cap.get(3)).map(|m| m.as_str()).unwrap_or("");
            match name.as_str() {
                "property" | "name" => key = value.to_lowercase(),
                "content" => content = decode_entities(value),
                _ => {}
            }
        }
        match key.as_str() {
            "og:title" => p.title = content,
            "og:description" => p.description = content,
            "og:image" | "og:image:url" if p.image.is_empty() => p.image = content,
            "og:site_name" => p.site = content,
            "twitter:title" => fallback_title = content,
            "twitter:image" if p.image.is_empty() => p.image = content,
            "description" | "twitter:description" => fallback_description = content,
            _ => {}
        }
    }

    if p.title.is_empty() {
        p.title = if fallback_title.is_empty() {
            TITLE.captures(html).map(|c| decode_entities(&c[1])).unwrap_or_default()
        } else {
            fallback_title
        };
    }
    if p.description.is_empty() {
        p.description = fallback_description;
    }
    if !p.image.is_empty() {
        p.image = base.join(&p.image).map(|u| u.to_string()).unwrap_or_default();
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_open_graph_tags() {
        let html = r#"<html><head><title>Fallback</title>
            <meta property="og:title" content="Kernel 7.3 &amp; more">
            <meta content='Scheduler work' property='og:description'>
            <meta property="og:image" content="/img/card.png">
            </head></html>"#;
        let p = parse(html, &Url::parse("https://example.org/news/1").unwrap());
        assert_eq!(p.title, "Kernel 7.3 & more");
        assert_eq!(p.description, "Scheduler work");
        assert_eq!(p.image, "https://example.org/img/card.png");
    }

    #[test]
    fn falls_back_to_title_tag() {
        let p = parse("<title> Plain page </title><meta name=\"description\" content=\"About\">", &Url::parse("https://e.org").unwrap());
        assert_eq!(p.title, "Plain page");
        assert_eq!(p.description, "About");
    }

    #[test]
    fn blocks_local_addresses() {
        assert!(!is_public("127.0.0.1".parse().unwrap()));
        assert!(!is_public("192.168.1.10".parse().unwrap()));
        assert!(!is_public("fe80::1".parse().unwrap()));
        assert!(is_public("93.184.216.34".parse().unwrap()));
    }
}
