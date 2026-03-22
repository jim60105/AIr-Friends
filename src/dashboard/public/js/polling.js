// Polling management

function startPolling() {
  pollActiveSessions();
  pollHistory();
  pollStats();
  pollingTimers.active = setInterval(pollActiveSessions, 5000);
  pollingTimers.history = setInterval(pollHistory, 10000);
  pollingTimers.stats = setInterval(pollStats, 10000);
}

function stopPolling() {
  Object.values(pollingTimers).forEach(clearInterval);
  pollingTimers = {};
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPolling();
  else startPolling();
});
