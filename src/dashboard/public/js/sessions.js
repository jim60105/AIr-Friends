// Session monitoring

const expandedAuditSessions = new Set();

async function pollActiveSessions() {
  try {
    const res = await fetch("/api/sessions/active");
    if (!res.ok) return;
    const sessions = await res.json();
    const body = document.getElementById("active-sessions-body");
    if (!sessions.length) {
      body.innerHTML =
        '<tr><td colspan="7" class="px-4 py-6 text-center text-gray-500">No active sessions</td></tr>';
      return;
    }
    body.innerHTML = sessions.map((s) =>
      `<tr class="hover:bg-surface-200/50">
      <td class="px-4 py-2.5 font-mono text-xs text-indigo-300">${esc(s.id?.slice(0, 12))}…</td>
      <td class="px-4 py-2.5">${esc(s.type || "—")}</td>
      <td class="px-4 py-2.5">${esc(s.platform)}</td>
      <td class="px-4 py-2.5 font-mono text-xs">${esc(s.userId)}</td>
      <td class="px-4 py-2.5 font-mono text-xs">${esc(s.channelId)}</td>
      <td class="px-4 py-2.5 text-xs">${timeAgo(s.startTime)}</td>
      <td class="px-4 py-2.5"><span class="inline-flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-green-400 status-dot-active"></span>Active</span></td>
    </tr>`
    ).join("");
  } catch (_) {}
}

async function pollHistory() {
  try {
    const res = await fetch("/api/sessions/history");
    if (!res.ok) return;
    const sessions = await res.json();
    const body = document.getElementById("history-sessions-body");
    if (!sessions.length) {
      body.innerHTML =
        '<tr><td colspan="8" class="px-4 py-6 text-center text-gray-500">No session history</td></tr>';
      return;
    }
    body.innerHTML = sessions.map((s) =>
      `<tr class="hover:bg-surface-200/50 cursor-pointer" data-audit-id="${
        esc(s.auditSessionId || s.id)
      }">
      <td class="px-4 py-2.5 font-mono text-xs text-indigo-300">${esc(s.id?.slice(0, 12))}…</td>
      <td class="px-4 py-2.5">${esc(s.type)}</td>
      <td class="px-4 py-2.5">${esc(s.platform)}</td>
      <td class="px-4 py-2.5 font-mono text-xs">${esc(s.userId)}</td>
      <td class="px-4 py-2.5 text-xs">${formatTime(s.startedAt)}</td>
      <td class="px-4 py-2.5 text-xs">${formatTime(s.endedAt)}</td>
      <td class="px-4 py-2.5 text-xs">${formatDuration(s.durationMs)}</td>
      <td class="px-4 py-2.5"><span class="inline-flex items-center gap-1.5"><span class="w-2 h-2 rounded-full ${
        s.status === "success" ? "bg-green-400" : "bg-red-400"
      }"></span>${esc(s.status)}</span></td>
    </tr>`
    ).join("");
    // Re-expand previously expanded audit rows
    for (const sessionId of expandedAuditSessions) {
      const rows = body.querySelectorAll("tr[data-audit-id]");
      for (const row of rows) {
        if (row.dataset.auditId === sessionId) {
          toggleAudit(row, sessionId);
          break;
        }
      }
    }
  } catch (_) {}
}

async function toggleAudit(row, sessionId) {
  const next = row.nextElementSibling;
  if (next && next.classList.contains("audit-row")) {
    next.remove();
    expandedAuditSessions.delete(sessionId);
    return;
  }
  expandedAuditSessions.add(sessionId);
  const tr = document.createElement("tr");
  tr.className = "audit-row";
  tr.innerHTML =
    '<td colspan="8" class="px-4 py-3"><p class="text-xs text-gray-500">Loading audit…</p></td>';
  row.after(tr);
  try {
    const res = await fetch(`/api/sessions/${sessionId}/audit`);
    if (!res.ok) {
      tr.querySelector("td").innerHTML = '<p class="text-xs text-gray-500">No audit data</p>';
      return;
    }
    const entries = await res.json();
    if (!entries.length) {
      tr.querySelector("td").innerHTML = '<p class="text-xs text-gray-500">No audit entries</p>';
      return;
    }
    tr.querySelector("td").innerHTML =
      `<div class="max-h-96 overflow-auto bg-surface-200 rounded-lg p-3 space-y-1 text-xs font-mono">
      ${
        entries.map((e) =>
          `<details class="audit-entry">
            <summary class="flex gap-3 cursor-pointer hover:bg-surface/50 rounded px-1 py-0.5 select-none">
              <span class="text-gray-500 shrink-0">${formatTime(e.ts)}</span>
              <span class="text-indigo-300">${esc(e.phase)}</span>
              <span class="text-gray-500 truncate">${
            esc(Object.keys(e.data || {}).join(", "))
          }</span>
            </summary>
            <pre class="mt-1 mb-2 ml-4 p-2 bg-surface/50 rounded text-gray-300 whitespace-pre-wrap overflow-auto max-h-80 text-xs">${
            esc(JSON.stringify(e.data || {}, null, 2))
          }</pre>
          </details>`
        ).join("")
      }
    </div>`;
  } catch (_) {
    tr.querySelector("td").innerHTML = '<p class="text-xs text-red-400">Failed to load audit</p>';
  }
}

// Delegated click handler for session history audit toggle
document.getElementById("history-sessions-body").addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-audit-id]");
  if (row) {
    toggleAudit(row, row.dataset.auditId);
  }
});
