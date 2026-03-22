// Authentication

async function checkAuth() {
  try {
    const res = await fetch("/api/auth/status");
    if (res.ok) {
      showDashboard();
      return;
    }
  } catch (_) {}
  showLogin();
}

function showLogin() {
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("dashboard").classList.add("hidden");
}

function showDashboard() {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
  switchTab("sessions");
  startPolling();
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("login-error");
  errEl.classList.add("hidden");
  const passphrase = document.getElementById("login-passphrase").value;
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    if (res.ok) showDashboard();
    else {
      errEl.textContent = "Invalid passphrase";
      errEl.classList.remove("hidden");
    }
  } catch (_) {
    errEl.textContent = "Connection error";
    errEl.classList.remove("hidden");
  }
});

async function doLogout() {
  await fetch("/api/auth/logout", { method: "POST" });
  stopPolling();
  showLogin();
}
