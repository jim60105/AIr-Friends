// Global state and initialization

let activeTab = "sessions";
let chatSessionId = null;
let chatEventSource = null;
let pollingTimers = {};

window.addEventListener("beforeunload", () => {
  if (chatSessionId) {
    navigator.sendBeacon("/api/chat/disconnect", JSON.stringify({ chatSessionId }));
  }
});

checkAuth();
