// Runs before the page draws. The lamp shows only when a chat was shown here before, so a
// chat is what loads next; anything else (a first start, the welcome) never shows it at all.
try {
  if (localStorage.getItem('lobby.chatShown')) {
    document.documentElement.classList.add('splash-on');
  }
} catch {
  // No storage: no lamp.
}
