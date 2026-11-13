//! Link previews: images by content type, pages by their Open Graph tags.

use regex::Regex;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, SocketAddr};
use std::sync::LazyLock;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(6);
const MAX_HTML_BYTES: usize = 512 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 (compatible; Lobby IRC client; link preview)";

static META: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<meta\s[^>]*>").unwrap());
static ATTR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?is)([a-z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')"#).unwrap());
static NUMERIC_ENTITY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));").unwrap());
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

const MAX_REDIRECTS: usize = 5;

fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            let shared = a == 100 && (64..128).contains(&b);
            let benchmark = a == 198 && (18..20).contains(&b);
            !(a == 0
                || v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_documentation()
                || shared
                || benchmark
                || a >= 240)
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public(IpAddr::V4(v4));
            }
            let first = v6.segments()[0];
            let local = (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80;
            !(v6.is_loopback() || v6.is_unspecified() || v6.is_multicast() || local)
        }
    }
}

/// The addresses a URL's host has, only when every one of them is public: a link must not reach
/// the local network. The request then goes to exactly these, so a second DNS answer cannot.
async fn public_addrs(url: &Url) -> Option<(String, Vec<SocketAddr>)> {
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let (host, port) = (url.host_str()?, url.port_or_known_default()?);
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port)).await.ok()?.collect();
    (!addrs.is_empty() && addrs.iter().all(|a| is_public(a.ip()))).then(|| (host.to_string(), addrs))
}

/// GET that checks every redirect hop the same way as the first address.
async fn get_public(url: &Url) -> Option<reqwest::Response> {
    let mut url = url.clone();
    for _ in 0..=MAX_REDIRECTS {
        let (host, addrs) = public_addrs(&url).await?;
        let client = lobby_core::http()
            .timeout(TIMEOUT)
            .user_agent(USER_AGENT)
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(&host, &addrs)
            .build()
            .ok()?;
        let res = client.get(url.clone()).send().await.ok()?;
        if !res.status().is_redirection() {
            return Some(res);
        }
        let next = res.headers().get("location")?.to_str().ok()?;
        url = url.join(next).ok()?;
    }
    None
}

/// A Dropbox share link opens a web page; with raw=1 it serves the file itself.
fn direct(url: &Url) -> Url {
    let host = url.host_str().unwrap_or("").trim_start_matches("www.");
    let shared = url.path().starts_with("/scl/fi/") || url.path().starts_with("/s/");
    if host != "dropbox.com" || !shared {
        return url.clone();
    }
    let mut file = url.clone();
    let query: Vec<(String, String)> =
        url.query_pairs().filter(|(k, _)| k != "dl").map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    file.query_pairs_mut().clear().extend_pairs(query).append_pair("raw", "1");
    file
}

/// An imgur page names its picture in og:image; `?fb` there is a 600x315 crop for Facebook.
fn imgur_picture(mut p: Preview, page: &Url) -> Preview {
    let site = page.host_str().unwrap_or("").trim_start_matches("www.").trim_start_matches("m.");
    let Ok(mut image) = Url::parse(&p.image) else {
        return p;
    };
    if site != "imgur.com" || image.host_str() != Some("i.imgur.com") {
        return p;
    }
    image.set_query(None);
    p.kind = "image".into();
    p.image = image.to_string();
    p
}

pub async fn fetch(raw: &str) -> Option<Preview> {
    let url = direct(&Url::parse(raw).ok()?);
    if is_youtube(&url) {
        let client = lobby_core::http().timeout(TIMEOUT).user_agent(USER_AGENT).build().ok()?;
        return youtube(&client, raw).await;
    }
    let mut res = get_public(&url).await?;
    if !res.status().is_success() {
        return None;
    }

    let content_type = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
    let site = url.host_str().unwrap_or("").trim_start_matches("www.").to_string();

    if content_type.starts_with("image/") {
        return Some(Preview { kind: "image".into(), url: raw.into(), image: res.url().to_string(), site, ..Default::default() });
    }
    for kind in ["video", "audio"] {
        if content_type.starts_with(&format!("{kind}/")) {
            let title = url.path_segments().and_then(|mut s| s.next_back()).unwrap_or("").to_string();
            return Some(Preview { kind: kind.into(), url: raw.into(), title, site, ..Default::default() });
        }
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

    let mut preview = imgur_picture(parse(&String::from_utf8_lossy(&body), res.url()), res.url());
    if preview.title.is_empty() && preview.image.is_empty() {
        return None;
    }
    preview.url = raw.into();
    if preview.site.is_empty() {
        preview.site = site;
    }
    // The page names the picture; it gets the same check before the app loads it.
    if let Ok(image) = Url::parse(&preview.image)
        && public_addrs(&image).await.is_none()
    {
        preview.image.clear();
    }
    Some(preview)
}

fn is_youtube(url: &Url) -> bool {
    let host = url.host_str().unwrap_or("").trim_start_matches("www.").trim_start_matches("m.");
    host == "youtube.com" || host == "youtu.be"
}

/// YouTube pages put their tags past the first megabyte; oEmbed gives the title directly.
async fn youtube(client: &reqwest::Client, raw: &str) -> Option<Preview> {
    #[derive(Deserialize)]
    struct OEmbed {
        title: String,
        #[serde(default)]
        thumbnail_url: String,
    }
    let api = Url::parse_with_params("https://www.youtube.com/oembed", &[("url", raw), ("format", "json")]).ok()?;
    let body = client.get(api).send().await.ok()?.error_for_status().ok()?.bytes().await.ok()?;
    let o: OEmbed = serde_json::from_slice(&body).ok()?;
    Some(Preview {
        kind: "page".into(),
        url: raw.into(),
        title: o.title,
        image: o.thumbnail_url,
        site: "youtube.com".into(),
        ..Default::default()
    })
}

/// Named entities that turn up in page titles and descriptions.
const NAMED: [(&str, &str); 30] = [
    ("quot", "\""),
    ("apos", "'"),
    ("lt", "<"),
    ("gt", ">"),
    ("nbsp", " "),
    ("amp", "&"),
    ("auml", "ä"),
    ("ouml", "ö"),
    ("aring", "å"),
    ("Auml", "Ä"),
    ("Ouml", "Ö"),
    ("Aring", "Å"),
    ("uuml", "ü"),
    ("Uuml", "Ü"),
    ("eacute", "é"),
    ("Eacute", "É"),
    ("egrave", "è"),
    ("aacute", "á"),
    ("szlig", "ß"),
    ("ntilde", "ñ"),
    ("deg", "°"),
    ("copy", "©"),
    ("reg", "®"),
    ("hellip", "…"),
    ("ndash", "–"),
    ("mdash", "—"),
    ("lsquo", "‘"),
    ("rsquo", "’"),
    ("ldquo", "“"),
    ("rdquo", "”"),
];

static NAMED_ENTITY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"&([A-Za-z]+);").unwrap());

fn decode_once(s: &str) -> String {
    let numeric = NUMERIC_ENTITY.replace_all(s, |c: &regex::Captures| {
        let code = match (c.get(1), c.get(2)) {
            (Some(hex), _) => u32::from_str_radix(hex.as_str(), 16).ok(),
            (_, Some(dec)) => dec.as_str().parse().ok(),
            _ => None,
        };
        code.and_then(char::from_u32).map(String::from).unwrap_or_else(|| c[0].to_string())
    });
    NAMED_ENTITY
        .replace_all(&numeric, |c: &regex::Captures| {
            NAMED.iter().find(|(name, _)| *name == &c[1]).map(|(_, ch)| ch.to_string()).unwrap_or_else(|| c[0].to_string())
        })
        .into_owned()
}

/// Some sites encode twice (`&amp;auml;`), so a second pass finishes the job.
fn decode_entities(s: &str) -> String {
    decode_once(&decode_once(s)).trim().to_string()
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
    fn dropbox_share_links_fetch_the_file() {
        let share = Url::parse("https://www.dropbox.com/scl/fi/abc/kuva.jpg?rlkey=x&st=y&e=1&dl=0").unwrap();
        assert_eq!(direct(&share).as_str(), "https://www.dropbox.com/scl/fi/abc/kuva.jpg?rlkey=x&st=y&e=1&raw=1");
        let other = Url::parse("https://example.org/kuva.jpg?dl=0").unwrap();
        assert_eq!(direct(&other), other);
    }

    #[test]
    fn imgur_pages_show_their_picture() {
        let html = r#"<title>Imgur: The magic of the Internet</title>
            <meta property="og:image" content="https://i.imgur.com/63pca7j.jpeg?fb">"#;
        let page = Url::parse("https://imgur.com/63pca7j").unwrap();
        let p = imgur_picture(parse(html, &page), &page);
        assert_eq!((p.kind.as_str(), p.image.as_str()), ("image", "https://i.imgur.com/63pca7j.jpeg"));
        let other = Url::parse("https://example.org/63pca7j").unwrap();
        assert_eq!(imgur_picture(parse(html, &other), &other).kind, "page");
    }

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
    fn decodes_numeric_entities() {
        assert_eq!(decode_entities("virtal&#228;hde &#x2014; &amp;"), "virtalähde — &");
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
        for blocked in ["::ffff:127.0.0.1", "::ffff:10.0.0.1", "0.1.2.3", "100.100.1.1", "169.254.169.254", "224.0.0.1", "fd00::1"] {
            assert!(!is_public(blocked.parse().unwrap()), "{blocked}");
        }
    }

    #[test]
    fn decodes_named_and_double_encoded_entities() {
        assert_eq!(decode_entities("n&amp;auml;ytt&amp;ouml; 178&amp;deg;"), "näyttö 178°");
        assert_eq!(decode_entities("Tom &amp; Jerry &quot;x&quot;"), "Tom & Jerry \"x\"");
    }
}
