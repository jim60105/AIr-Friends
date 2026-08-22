// Stats polling

async function pollStats() {
  try {
    const res = await fetch("/api/stats");
    if (!res.ok) return;
    const data = await res.json();
    const grid = document.getElementById("stats-grid");
    const cards = [
      {
        label: "Sessions Total",
        value: data.sessions_total ?? data.sessionsTotal ?? 0,
        icon: "📊",
      },
      {
        label: "Active Sessions",
        value: data.active_sessions ?? data.activeSessions ?? 0,
        icon: "⚡",
      },
      {
        label: "Replies Sent",
        value: data.replies_sent_total ?? data.repliesSentTotal ?? 0,
        icon: "💬",
      },
      {
        label: "Messages Received",
        value: data.messages_received_total ?? data.messagesReceivedTotal ?? 0,
        icon: "📩",
      },
      {
        label: "Memory Operations",
        value: data.memory_operations_total ?? data.memoryOperationsTotal ?? 0,
        icon: "🧠",
      },
      {
        label: "Skill API Calls",
        value: data.skill_api_calls_total ?? data.skillApiCallsTotal ?? 0,
        icon: "🔧",
      },
    ];
    const cardsHtml = cards.map((c) =>
      `<div class="bg-surface-100 border border-accent-muted rounded-xl p-5">
      <div class="text-2xl mb-2">${esc(c.icon)}</div>
      <div class="text-2xl font-bold text-gray-100">${esc(c.value)}</div>
      <div class="text-xs text-gray-400 mt-1">${esc(c.label)}</div>
    </div>`
    ).join("");
    if (typeof DOMPurify !== "undefined") {
      grid.innerHTML = DOMPurify.sanitize(cardsHtml);
    } else {
      grid.textContent = cardsHtml;
    }
  } catch (_) {}
}
