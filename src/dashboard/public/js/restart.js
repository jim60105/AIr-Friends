// Restart

async function doRestart() {
  try {
    const res = await fetch("/api/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: false }),
    });
    const data = await res.json();
    document.getElementById("restart-msg").textContent = data.warning ||
      `${data.activeSessionCount || 0} active session(s) will be terminated. Are you sure?`;
    document.getElementById("restart-modal").classList.remove("hidden");
  } catch (_) {
    document.getElementById("restart-msg").textContent = "Are you sure you want to restart?";
    document.getElementById("restart-modal").classList.remove("hidden");
  }
}

function closeRestartModal() {
  document.getElementById("restart-modal").classList.add("hidden");
}

async function confirmRestart() {
  closeRestartModal();
  try {
    await fetch("/api/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: true }),
    });
  } catch (_) {}
}
