//! Where attachments go: an S3 bucket such as Cloudflare R2, a folder a web server serves,
//! a file host that answers with the file's address, or catbox.moe. Each returns the
//! address the file can be opened at.

use rusty_s3::{Bucket, Credentials, S3Action, UrlStyle};
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const MAX_BYTES: usize = 20 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(120);
const SIGNED_FOR: Duration = Duration::from_secs(300);
const CATBOX_API: &str = "https://catbox.moe/user/api.php";
const DEFAULT_REGION: &str = "auto";
const STEM_MAX: usize = 64;
const FOLDER_BYTES: usize = 8;

/// What a bucket or folder of our own keeps, and the extension it is saved under. Anything
/// else is refused, so nothing a browser would run (html, svg) is served from your domain.
const TYPES: [(&str, &str); 7] = [
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/gif", "gif"),
    ("image/webp", "webp"),
    ("image/avif", "avif"),
    ("application/pdf", "pdf"),
    ("text/plain", "txt"),
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Target {
    /// A host that takes the file as the POST body and answers with `Location`, like
    /// `tools/filehost/upload.php`, soju or Halloy's hosts.
    FileHost {
        url: String,
    },
    /// Any S3 storage. For Cloudflare R2 the endpoint is `https://<account>.r2.cloudflarestorage.com`.
    S3 {
        endpoint: String,
        #[serde(default)]
        region: String,
        bucket: String,
        access_key: String,
        secret_key: String,
        /// Where the bucket is served, like `https://files.example.org`.
        public_url: String,
    },
    /// A folder on this machine that a web server serves at `public_url`.
    Folder {
        dir: String,
        public_url: String,
    },
    Catbox,
}

pub struct File {
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

pub async fn send(target: &Target, file: File) -> Result<String, String> {
    if file.bytes.len() > MAX_BYTES {
        return Err(format!("Files up to {} MB can be sent", MAX_BYTES / 1024 / 1024));
    }
    match target {
        Target::FileHost { url } => file_host(url, file).await,
        Target::S3 { endpoint, region, bucket, access_key, secret_key, public_url } => {
            let region = if region.is_empty() { DEFAULT_REGION } else { region };
            s3(endpoint, region, bucket, &Credentials::new(access_key, secret_key), public_url, file).await
        }
        Target::Folder { dir, public_url } => folder(dir, public_url, file).await,
        Target::Catbox => catbox(file).await,
    }
}

fn client() -> Result<reqwest::Client, String> {
    // HTTP/1.1: catbox.moe breaks off large uploads over HTTP/2 ("stream error received").
    crate::http().timeout(TIMEOUT).http1_only().build().map_err(|e| e.to_string())
}

/// "Holiday photo.PNG" sent as image/png is kept as "<random>/Holiday-photo.png".
pub fn stored_name(name: &str, mime: &str) -> Result<String, String> {
    let mime = mime.split(';').next().unwrap_or("").trim().to_lowercase();
    let ext = TYPES.iter().find(|(t, _)| *t == mime).map(|(_, e)| *e).ok_or("Only pictures, PDFs and text files can be sent")?;
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let stem = base.rsplit_once('.').map_or(base, |(s, _)| s);
    let mut clean = String::new();
    for c in stem.chars() {
        if c.is_ascii_alphanumeric() || "._-".contains(c) {
            clean.push(c);
        } else if !clean.ends_with('-') {
            clean.push('-');
        }
    }
    let clean: String = clean.chars().take(STEM_MAX).collect();
    let clean = clean.trim_matches(|c| c == '-' || c == '.');
    let stem = if clean.is_empty() { "file" } else { clean };

    let mut folder = [0u8; FOLDER_BYTES];
    getrandom::fill(&mut folder).map_err(|e| e.to_string())?;
    let folder: String = folder.iter().map(|b| format!("{b:02x}")).collect();
    Ok(format!("{folder}/{stem}.{ext}"))
}

fn joined(base: &str, path: &str) -> String {
    format!("{}/{path}", base.trim_end_matches('/'))
}

async fn file_host(url: &str, file: File) -> Result<String, String> {
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err("Set a file host address in Settings first".into());
    }
    let name: String = file
        .name
        .bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect();
    let res = client()?
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, if file.mime.is_empty() { "application/octet-stream" } else { &file.mime })
        .header(reqwest::header::CONTENT_DISPOSITION, format!("attachment; filename*=UTF-8''{name}"))
        .body(file.bytes)
        .send()
        .await
        .map_err(|e| format!("Upload failed: {}", why(&e)))?;
    let status = res.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            413 => "The file is too big for the file host".into(),
            415 => "The file host does not take this type of file".into(),
            code => format!("The file host answered {code}"),
        });
    }
    res.headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .map(String::from)
        .ok_or("The file host did not say where the file went".into())
}

async fn s3(endpoint: &str, region: &str, bucket: &str, credentials: &Credentials, public_url: &str, file: File) -> Result<String, String> {
    let key = stored_name(&file.name, &file.mime)?;
    let endpoint = reqwest::Url::parse(endpoint).map_err(|e| format!("The S3 address: {e}"))?;
    let bucket =
        Bucket::new(endpoint, UrlStyle::Path, bucket.to_string(), region.to_string()).map_err(|e| format!("The S3 bucket: {e}"))?;
    let url = bucket.put_object(Some(credentials), &key).sign(SIGNED_FOR);
    let res = client()?
        .put(url)
        .header(reqwest::header::CONTENT_TYPE, &file.mime)
        .body(file.bytes)
        .send()
        .await
        .map_err(|e| format!("Upload failed: {}", why(&e)))?;
    let status = res.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => "The S3 storage refused the key".into(),
            404 => "The S3 storage has no such bucket".into(),
            code => format!("The S3 storage answered {code}"),
        });
    }
    Ok(joined(public_url, &key))
}

async fn folder(dir: &str, public_url: &str, file: File) -> Result<String, String> {
    let name = stored_name(&file.name, &file.mime)?;
    let path = std::path::Path::new(dir).join(&name);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    tokio::fs::write(&path, &file.bytes).await.map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(joined(public_url, &name))
}

/// The error with its causes: reqwest's own text ("error sending request") hides the real reason.
fn why(e: &dyn std::error::Error) -> String {
    let mut text = e.to_string();
    let mut cause = e.source();
    while let Some(c) = cause {
        text.push_str(": ");
        text.push_str(&c.to_string());
        cause = c.source();
    }
    text
}

async fn catbox(file: File) -> Result<String, String> {
    let part = reqwest::multipart::Part::bytes(file.bytes).file_name(file.name).mime_str(&file.mime).map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().text("reqtype", "fileupload").part("fileToUpload", part);
    let res = client()?.post(CATBOX_API).multipart(form).send().await.map_err(|e| format!("Upload failed: {}", why(&e)))?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    let text = text.trim();
    if status.is_success() && text.starts_with("https://") {
        return Ok(text.to_string());
    }
    Err(if text.is_empty() { format!("catbox.moe answered {status}") } else { format!("catbox.moe: {text}") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_stored_files() {
        let name = stored_name("Holiday photo.PNG", "image/png").unwrap();
        let (folder, file) = name.split_once('/').unwrap();
        assert_eq!(folder.len(), FOLDER_BYTES * 2);
        assert_eq!(file, "Holiday-photo.png");
        assert!(stored_name("../../etc/passwd", "text/plain").unwrap().ends_with("/passwd.txt"));
        assert!(stored_name("x.html", "text/html").is_err());
        assert!(stored_name("åäö.jpg", "image/jpeg; charset=x").unwrap().ends_with("/file.jpg"));
    }

    #[test]
    fn reads_targets_from_settings() {
        let t: Target = serde_json::from_str(r#"{"kind":"s3","endpoint":"https://a.r2.cloudflarestorage.com","bucket":"b","access_key":"k","secret_key":"s","public_url":"https://f.example.org"}"#).unwrap();
        assert!(matches!(t, Target::S3 { ref region, .. } if region.is_empty()));
        assert_eq!(serde_json::from_str::<Target>(r#"{"kind":"catbox"}"#).unwrap(), Target::Catbox);
    }

    /// The bucket gets a signed PUT at /bucket/key with the file's type, and the link uses the public address.
    #[tokio::test]
    async fn puts_files_into_a_bucket() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut seen = Vec::new();
            let mut buf = [0u8; 4096];
            while !seen.ends_with(b"hi") {
                let n = socket.read(&mut buf).await.unwrap();
                seen.extend_from_slice(&buf[..n]);
            }
            socket.write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n").await.unwrap();
            String::from_utf8(seen).unwrap()
        });
        let target = Target::S3 {
            endpoint,
            region: String::new(),
            bucket: "files".into(),
            access_key: "key".into(),
            secret_key: "secret".into(),
            public_url: "https://f.example.org".into(),
        };
        let url = send(&target, File { name: "a.txt".into(), mime: "text/plain".into(), bytes: b"hi".to_vec() }).await.unwrap();
        let request = server.await.unwrap();
        let key = url.strip_prefix("https://f.example.org/").unwrap();
        assert!(request.starts_with(&format!("PUT /files/{key}?")), "{request}");
        assert!(request.contains("X-Amz-Credential=key%2F") && request.contains("%2Fauto%2Fs3%2Faws4_request"), "{request}");
        assert!(request.contains("X-Amz-Signature="));
        assert!(request.to_lowercase().contains("content-type: text/plain"));
    }

    #[tokio::test]
    async fn keeps_files_in_a_folder() {
        let dir = std::env::temp_dir().join(format!("lobby-upload-test-{}", std::process::id()));
        let target = Target::Folder { dir: dir.display().to_string(), public_url: "https://f.example.org/u/".into() };
        let url = send(&target, File { name: "a.txt".into(), mime: "text/plain".into(), bytes: b"hi".to_vec() }).await.unwrap();
        let name = url.strip_prefix("https://f.example.org/u/").unwrap();
        assert_eq!(std::fs::read(dir.join(name)).unwrap(), b"hi");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
