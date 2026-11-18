//! AI features through the user's own OpenRouter key. Only the summary model can be changed in Settings.

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;

const API: &str = "https://openrouter.ai/api/v1";
// Picked on 13.11.2026 from the cheapest models: right on every case of the reply test set, three runs in a row.
const MODEL: &str = "google/gemini-2.5-flash-lite";
const TIMEOUT: Duration = Duration::from_secs(15);
const ANSWER_TOKENS: u32 = 8;
const REPLY_SYSTEM: &str = "You match IRC replies to the earlier message they answer. Reply with a single number.";
// The default when the user has not chosen a model in Settings.
const SUMMARY_MODEL: &str = "google/gemini-3.8-flash";
const SUMMARY_TIMEOUT: Duration = Duration::from_secs(90);
// Room for the link markup; the app cuts the text itself at 500 shown characters.
const SUMMARY_TOKENS: u32 = 1500;
// Added after the user's own prompt, which can be edited, so an edit never breaks the links.
const SUMMARY_FORMAT: &str = "Answer with the summary text only, in short paragraphs separated by a blank line, with no headings or lists. \
When a phrase is about a particular message, link it as [phrase](N) with that message's number. \
Never write a message number anywhere else, so no bare [N] after a name or a sentence. \
Speak to the reader directly with the word for you in the summary's own language, never by their nick and never with the English word in another language.";

#[derive(Deserialize)]
pub struct ChatLine {
    pub nick: String,
    pub text: String,
}

/// A message to summarize, with its time as the reader would say it.
#[derive(Deserialize)]
pub struct SummaryLine {
    pub at: String,
    pub nick: String,
    pub text: String,
}

/// What a working key may still spend, in US dollars of OpenRouter credit.
#[derive(Serialize)]
pub struct KeyInfo {
    pub usage: f64,
    pub limit: Option<f64>,
    pub limit_remaining: Option<f64>,
    pub limit_reset: Option<String>,
}

/// The error for a key OpenRouter turned down, told apart from a network failure.
pub const KEY_REJECTED: &str = "rejected";

/// Whether OpenRouter accepts the key, and its spending limit.
pub async fn check_key(key: &str) -> Result<KeyInfo, String> {
    let res = client(TIMEOUT)?.get(format!("{API}/key")).bearer_auth(key).send().await.map_err(|e| format!("OpenRouter: {e}"))?;
    let status = res.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(KEY_REJECTED.into());
    }
    if !status.is_success() {
        return Err(format!("OpenRouter: {status}"));
    }
    let json: Value = res.json().await.map_err(|e| format!("OpenRouter: {e}"))?;
    Ok(key_info(&json))
}

fn key_info(json: &Value) -> KeyInfo {
    let data = &json["data"];
    KeyInfo {
        usage: data["usage"].as_f64().unwrap_or(0.0),
        limit: data["limit"].as_f64(),
        limit_remaining: data["limit_remaining"].as_f64(),
        limit_reset: data["limit_reset"].as_str().map(str::to_owned),
    }
}

/// Which of `lines` (oldest first) by `to` the message from `from` answers, as an index into `lines`.
pub async fn reply_target(key: &str, lines: &[ChatLine], from: &str, to: &str, text: &str) -> Result<Option<usize>, String> {
    let choices = choices(lines, to);
    if choices.len() < 2 {
        return Ok(choices.first().copied());
    }
    let body = json!({
        "model": MODEL,
        "messages": [{ "role": "system", "content": REPLY_SYSTEM }, { "role": "user", "content": reply_prompt(lines, &choices, from, to, text) }],
        "max_tokens": ANSWER_TOKENS,
        "temperature": 0,
    });
    let answer = complete(key, &body, TIMEOUT).await?;
    Ok(picked(&answer, &choices))
}

/// What the unread `lines` (oldest first) said, as text with `[phrase](N)` links to line N, counted from 1.
pub async fn summary(key: &str, model: &str, lines: &[SummaryLine], prompt: &str, now: &str) -> Result<String, String> {
    let model = model.trim();
    let body = json!({
        "model": if model.is_empty() { SUMMARY_MODEL } else { model },
        "messages": [{ "role": "user", "content": summary_prompt(lines, prompt, now) }],
        "max_tokens": SUMMARY_TOKENS,
        "temperature": 0.3,
        // The model always thinks; the least of it is enough here, and none of it is shown.
        "reasoning": { "effort": "minimal", "exclude": true },
    });
    complete(key, &body, SUMMARY_TIMEOUT).await
}

fn summary_prompt(lines: &[SummaryLine], prompt: &str, now: &str) -> String {
    let rows: Vec<String> = lines.iter().enumerate().map(|(i, l)| format!("[{}] {} {}: {}", i + 1, l.at, l.nick, l.text)).collect();
    format!("{prompt}\n\n{SUMMARY_FORMAT}\n\nIt is now {now}.\n\nMessages, oldest first:\n{}", rows.join("\n"))
}

/// The model's answer text, or OpenRouter's own error.
async fn complete(key: &str, body: &Value, timeout: Duration) -> Result<String, String> {
    let res = client(timeout)?
        .post(format!("{API}/chat/completions"))
        .bearer_auth(key)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("OpenRouter: {e}"))?;
    let status = res.status();
    let json: Value = res.json().await.map_err(|e| format!("OpenRouter: {e}"))?;
    if !status.is_success() {
        return Err(format!("OpenRouter: {}", json["error"]["message"].as_str().unwrap_or(status.as_str())));
    }
    Ok(json["choices"][0]["message"]["content"].as_str().unwrap_or("").trim().to_owned())
}

fn client(timeout: Duration) -> Result<reqwest::Client, String> {
    lobby_core::http().timeout(timeout).build().map_err(|e| e.to_string())
}

/// The lines `to` wrote, as indexes.
fn choices(lines: &[ChatLine], to: &str) -> Vec<usize> {
    lines.iter().enumerate().filter(|(_, l)| l.nick.eq_ignore_ascii_case(to)).map(|(i, _)| i).collect()
}

fn reply_prompt(lines: &[ChatLine], choices: &[usize], from: &str, to: &str, text: &str) -> String {
    let rows: Vec<String> = lines.iter().enumerate().map(|(i, l)| format!("[{}] {}: {}", i + 1, l.nick, l.text)).collect();
    let options: Vec<String> = choices.iter().map(|i| (i + 1).to_string()).collect();
    format!(
        "IRC chat, oldest first:\n{}\n\nNew message from {from} to {to}: \"{text}\"\n\nWhich message by {to} is {from} answering? Choose from: {}. Reply with the number only.",
        rows.join("\n"),
        options.join(", ")
    )
}

/// The answer's number, when it is one of the choices.
fn picked(answer: &str, choices: &[usize]) -> Option<usize> {
    let digits: String = answer.chars().skip_while(|c| !c.is_ascii_digit()).take_while(char::is_ascii_digit).collect();
    let n: usize = digits.parse().ok()?;
    choices.iter().copied().find(|&i| i + 1 == n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(nick: &str, text: &str) -> ChatLine {
        ChatLine { nick: nick.into(), text: text.into() }
    }

    #[test]
    fn offers_only_the_addressed_nicks_lines() {
        let lines = [line("otso", "levy"), line("kaisla", "mikä?"), line("Otso", "palaveri")];
        assert_eq!(choices(&lines, "otso"), vec![0, 2]);
        let p = reply_prompt(&lines, &[0, 2], "kaisla", "otso", "hyvä levy");
        assert!(p.contains("[2] kaisla: mikä?") && p.contains("Choose from: 1, 3."));
    }

    #[test]
    fn reads_the_number_and_refuses_other_lines() {
        assert_eq!(picked("3", &[0, 2]), Some(2));
        assert_eq!(picked(" [1]\n", &[0, 2]), Some(0));
        assert_eq!(picked("2", &[0, 2]), None);
        assert_eq!(picked("none", &[0, 2]), None);
    }

    #[test]
    fn numbers_the_lines_after_the_users_prompt() {
        let lines = [SummaryLine { at: "14.32".into(), nick: "sumu".into(), text: "saunaa?".into() }];
        let p = summary_prompt(&lines, "Summarize for rolle.", "Tue 16.05");
        assert!(p.starts_with("Summarize for rolle.\n\n"));
        assert!(p.contains("[phrase](N)") && p.contains("It is now Tue 16.05.") && p.ends_with("[1] 14.32 sumu: saunaa?"));
    }

    #[test]
    fn reads_the_keys_spending_limit() {
        let info = key_info(&json!({ "data": { "usage": 0.25, "limit": 10, "limit_remaining": 9.75, "limit_reset": "monthly" } }));
        assert_eq!(
            (info.usage, info.limit, info.limit_remaining, info.limit_reset.as_deref()),
            (0.25, Some(10.0), Some(9.75), Some("monthly"))
        );
        let open = key_info(&json!({ "data": { "usage": 1.5, "limit": null, "limit_remaining": null } }));
        assert_eq!((open.limit, open.limit_remaining), (None, None));
    }

    /// Asks OpenRouter for real, with the key in OPENROUTER_KEY_FILE: `cargo test -p lobby -- --ignored live`.
    #[tokio::test]
    #[ignore]
    async fn live_reply_target() {
        let key = std::fs::read_to_string(std::env::var("OPENROUTER_KEY_FILE").unwrap()).unwrap();
        let lines = [
            line("otso", "kuuntelin eilen sen vanhan levyn, kunnon nostatus"),
            line("kaisla", "mikä levy?"),
            line("otso", "pitää lähteä palaveriin 10 min päästä"),
        ];
        let got = reply_target(key.trim(), &lines, "kaisla", "otso", "no on kyl hyvä levy").await.unwrap();
        assert_eq!(got, Some(0));
        check_key(key.trim()).await.unwrap();
        let unread = [
            SummaryLine { at: "Tue 14.32".into(), nick: "sumu".into(), text: "kukkuu".into() },
            SummaryLine { at: "Tue 14.33".into(), nick: "sumu".into(), text: "lauantaina saunaa mun luona kuudelta, kuka tulee?".into() },
            SummaryLine { at: "Tue 14.34".into(), nick: "otso".into(), text: "mä! tuon makkarat".into() },
            SummaryLine { at: "Tue 15.47".into(), nick: "veera".into(), text: "rolle: voisitko taas pyörittää kuvalatauksia?".into() },
        ];
        let text = summary(
            key.trim(),
            "",
            &unread,
            "Summarize these unread IRC messages for rolle in English, at most 500 characters.",
            "Tue 16.05",
        )
        .await
        .unwrap();
        println!("{text}");
        assert!(text.contains("](") && !text.is_empty());
        assert!(check_key("sk-or-v1-wrong").await.is_err());
    }
}
