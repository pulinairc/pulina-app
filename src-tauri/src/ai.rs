//! AI features through the user's own OpenRouter key. The model is chosen here, not in Settings.

use serde::Deserialize;
use serde_json::{Value, json};
use std::time::Duration;

const API: &str = "https://openrouter.ai/api/v1";
// Picked on 13.11.2026 from the cheapest models: right on every case of the reply test set, three runs in a row.
const MODEL: &str = "google/gemini-2.5-flash-lite";
const TIMEOUT: Duration = Duration::from_secs(15);
const ANSWER_TOKENS: u32 = 8;
const REPLY_SYSTEM: &str = "You match IRC replies to the earlier message they answer. Reply with a single number.";

#[derive(Deserialize)]
pub struct ChatLine {
    pub nick: String,
    pub text: String,
}

/// Whether OpenRouter accepts the key.
pub async fn check_key(key: &str) -> Result<(), String> {
    let res = client()?.get(format!("{API}/key")).bearer_auth(key).send().await.map_err(|e| format!("OpenRouter: {e}"))?;
    if res.status().is_success() {
        return Ok(());
    }
    Err(format!("OpenRouter: {}", res.status()))
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
    let res = client()?
        .post(format!("{API}/chat/completions"))
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenRouter: {e}"))?;
    let status = res.status();
    let json: Value = res.json().await.map_err(|e| format!("OpenRouter: {e}"))?;
    if !status.is_success() {
        return Err(format!("OpenRouter: {}", json["error"]["message"].as_str().unwrap_or(status.as_str())));
    }
    Ok(picked(json["choices"][0]["message"]["content"].as_str().unwrap_or(""), &choices))
}

fn client() -> Result<reqwest::Client, String> {
    lobby_core::http().timeout(TIMEOUT).build().map_err(|e| e.to_string())
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
        assert!(check_key("sk-or-v1-wrong").await.is_err());
    }
}
