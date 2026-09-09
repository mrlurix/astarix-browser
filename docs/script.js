// Copy clone command
document.getElementById('copy-btn').addEventListener('click', async function () {
  const text = document.getElementById('clone-cmd').textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
  const btn = this;
  btn.textContent = '✓';
  setTimeout(() => { btn.textContent = '⧉'; }, 1500);
});

// Mockup theme toggle (mirrors the app's dark/light setting)
document.getElementById('mock-theme-btn').addEventListener('click', function () {
  const mock = document.getElementById('mock');
  const light = mock.classList.toggle('light');
  this.textContent = light ? '☀ Toggle dark theme' : '☾ Toggle light theme';
});
