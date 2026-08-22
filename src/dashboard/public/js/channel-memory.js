// Channel memory moderation (F15)

let channelMemoryCurrent = "";

async function loadChannelMemoryChannels() {
  const select = document.getElementById("channel-memory-select");
  if (!select) return;
  try {
    const res = await fetch("/api/channel-memory/channels");
    if (!res.ok) return;
    const data = await res.json();
    const channels = data.channels || [];
    const previous = channelMemoryCurrent;
    const optionsHtml = '<option value="">Select a channel…</option>' +
      channels.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    if (typeof DOMPurify !== "undefined") {
      select.innerHTML = DOMPurify.sanitize(optionsHtml);
    } else {
      // Fallback: build options via the DOM API so remote data never touches innerHTML.
      select.textContent = "";
      const defaultOpt = document.createElement("option");
      defaultOpt.value = "";
      defaultOpt.textContent = "Select a channel…";
      select.appendChild(defaultOpt);
      for (const c of channels) {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
      }
    }
    if (previous && channels.includes(previous)) {
      select.value = previous;
      loadChannelMemories(previous);
    }
  } catch (_) {
    // Non-fatal; leave the selector as-is.
  }
}

async function loadChannelMemories(channel) {
  channelMemoryCurrent = channel || "";
  const tbody = document.getElementById("channel-memory-table");
  if (!tbody) return;
  if (!channel) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">Select a channel to view its memories.</td></tr>';
    return;
  }
  tbody.innerHTML =
    '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">Loading…</td></tr>';
  try {
    const res = await fetch(`/api/channel-memory/list?channel=${encodeURIComponent(channel)}`);
    if (!res.ok) {
      tbody.innerHTML =
        '<tr><td colspan="5" class="px-4 py-8 text-center text-red-400">Failed to load.</td></tr>';
      return;
    }
    const data = await res.json();
    renderChannelMemories(data.memories || []);
  } catch (_) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="px-4 py-8 text-center text-red-400">Connection error.</td></tr>';
  }
}

function renderChannelMemories(memories) {
  const tbody = document.getElementById("channel-memory-table");
  if (!tbody) return;
  if (memories.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="px-4 py-8 text-center text-gray-500">No channel memories.</td></tr>';
    return;
  }
  const rowsHtml = memories.map((m) => {
    const statusBadge = m.enabled
      ? '<span class="px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 text-xs font-semibold">enabled</span>'
      : '<span class="px-2 py-0.5 rounded-full bg-gray-500/15 text-gray-400 text-xs font-semibold">disabled</span>';
    const action = m.enabled
      ? `<button data-mem-id="${
        esc(m.id)
      }" class="px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-500 text-white text-xs font-semibold transition-colors">Disable</button>`
      : '<span class="text-gray-600 text-xs">—</span>';
    return `<tr class="border-t border-white/5">
        <td class="px-4 py-3 text-gray-400 whitespace-nowrap">${esc(m.author || "unknown")}</td>
        <td class="px-4 py-3 text-gray-200">${esc(m.content)}</td>
        <td class="px-4 py-3 text-gray-400 whitespace-nowrap">${esc(m.tier)}</td>
        <td class="px-4 py-3 whitespace-nowrap">${statusBadge}</td>
        <td class="px-4 py-3 text-right whitespace-nowrap">${action}</td>
      </tr>`;
  }).join("");
  if (typeof DOMPurify !== "undefined") {
    tbody.innerHTML = DOMPurify.sanitize(rowsHtml);
  } else {
    tbody.textContent = rowsHtml;
  }
}

async function disableChannelMemory(id) {
  if (!channelMemoryCurrent || !id) return;
  try {
    const res = await fetch("/api/channel-memory/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel: channelMemoryCurrent, id }),
    });
    if (res.ok) {
      loadChannelMemories(channelMemoryCurrent);
    }
  } catch (_) {
    // Non-fatal; the row stays as-is and the operator can retry.
  }
}

// Delegated click handler for the channel-memory "Disable" button.
// DOMPurify strips inline onclick handlers, so the button carries a
// data-mem-id attribute and the action is dispatched via delegation.
const channelMemoryTable = document.getElementById("channel-memory-table");
if (channelMemoryTable) {
  channelMemoryTable.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mem-id]");
    if (btn) {
      disableChannelMemory(btn.dataset.memId);
    }
  });
}
