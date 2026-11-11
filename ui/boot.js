// Runs before the page draws: without a chat ever shown here, the start opens on the welcome, not the lamp.
try {
  if (!localStorage.getItem('lobby.chatShown')) {
    document.documentElement.classList.add('no-splash');
  }
} catch {
  // No storage: the lamp shows as before.
}
