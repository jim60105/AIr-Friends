// Chat

// Populate model suggestions from server config
(async function loadModelSuggestions() {
  try {
    const res = await fetch("/api/config/models");
    if (res.ok) {
      const models = await res.json();
      const datalist = document.getElementById("model-suggestions");
      datalist.innerHTML = models.map((m) => `<option value="${esc(m)}"></option>`).join("");
    }
  } catch (_) { /* ignore */ }
})();

async function chatConnect() {
  const agentType = document.getElementById("chat-agent-type").value;
  const model = document.getElementById("chat-model").value;
  const btn = document.getElementById("chat-connect-btn");
  const statusEl = document.getElementById("chat-status");
  btn.disabled = true;
  btn.textContent = "Connecting…";
  statusEl.classList.remove("hidden");
  statusEl.textContent = "Connecting to agent…";
  try {
    const res = await fetch("/api/chat/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentType, model }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      statusEl.textContent = `Error: ${err.error || res.statusText}`;
      statusEl.className = "text-xs text-red-400 mt-2";
      btn.disabled = false;
      btn.textContent = "Connect";
      return;
    }
    const data = await res.json();
    chatSessionId = data.chatSessionId;
    statusEl.textContent = `Connected (${agentType}/${model || "default"})`;
    statusEl.className = "text-xs text-green-400 mt-2";

    // UI state
    btn.classList.add("hidden");
    document.getElementById("chat-disconnect-btn").classList.remove("hidden");
    document.getElementById("chat-agent-type").disabled = true;
    document.getElementById("chat-model").disabled = true;
    document.getElementById("chat-input").disabled = false;
    document.getElementById("chat-send-btn").disabled = false;
    document.getElementById("chat-messages").innerHTML = "";

    // Open SSE
    chatEventSource = new EventSource(
      `/api/chat/stream?chatSessionId=${chatSessionId}`,
    );
    let currentAgentMsg = null;

    chatEventSource.addEventListener("message", (e) => {
      removeTypingIndicator();
      const data = JSON.parse(e.data);
      if (!currentAgentMsg) {
        currentAgentMsg = appendMessage("agent", "");
      }
      // Check for <think> blocks
      const text = data.text || data.content || "";
      appendToMessage(currentAgentMsg, text);
    });

    chatEventSource.addEventListener("think", (e) => {
      removeTypingIndicator();
      const data = JSON.parse(e.data);
      if (!currentAgentMsg) {
        currentAgentMsg = appendMessage("agent", "");
      }
      appendThinkBlock(currentAgentMsg, data.text || data.content || "");
    });

    chatEventSource.addEventListener("done", () => {
      removeTypingIndicator();
      currentAgentMsg = null;
    });

    chatEventSource.addEventListener("error", (e) => {
      removeTypingIndicator();
      if (chatEventSource.readyState === EventSource.CLOSED) return;
      try {
        const data = JSON.parse(e.data);
        appendSystemMessage(`Error: ${data.error || "Unknown error"}`);
      } catch (_) {
        appendSystemMessage("Connection error");
      }
      currentAgentMsg = null;
    });

    chatEventSource.addEventListener("disconnect", (e) => {
      removeTypingIndicator();
      try {
        const data = JSON.parse(e.data);
        if (data.reason === "idle_timeout") {
          appendSystemMessage("⏱ Disconnected due to idle timeout");
        } else {
          appendSystemMessage("Disconnected");
        }
      } catch (_) {
        appendSystemMessage("Disconnected");
      }
      chatPostDisconnect();
    });
  } catch (_) {
    statusEl.textContent = "Connection failed";
    statusEl.className = "text-xs text-red-400 mt-2";
    btn.disabled = false;
    btn.textContent = "Connect";
  }
}

async function chatDisconnect() {
  if (chatEventSource) {
    chatEventSource.close();
    chatEventSource = null;
  }
  if (chatSessionId) {
    try {
      await fetch("/api/chat/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatSessionId }),
      });
    } catch (_) {}
  }
  chatPostDisconnect();
}

function chatPostDisconnect() {
  if (chatEventSource) {
    chatEventSource.close();
    chatEventSource = null;
  }
  chatSessionId = null;
  document.getElementById("chat-connect-btn").classList.add("hidden");
  document.getElementById("chat-disconnect-btn").classList.add("hidden");
  document.getElementById("chat-input").disabled = true;
  document.getElementById("chat-send-btn").disabled = true;
  document.getElementById("chat-reconnect").classList.remove("hidden");
  const statusEl = document.getElementById("chat-status");
  statusEl.textContent = "Disconnected";
  statusEl.className = "text-xs text-gray-400 mt-2";
}

function chatReset() {
  chatSessionId = null;
  document.getElementById("chat-messages").innerHTML =
    '<p class="text-gray-500 text-center text-sm py-8">Connect to an agent to start chatting</p>';
  document.getElementById("chat-reconnect").classList.add("hidden");
  document.getElementById("chat-connect-btn").classList.remove("hidden");
  document.getElementById("chat-connect-btn").disabled = false;
  document.getElementById("chat-connect-btn").textContent = "Connect";
  document.getElementById("chat-disconnect-btn").classList.add("hidden");
  document.getElementById("chat-agent-type").disabled = false;
  document.getElementById("chat-model").disabled = false;
  document.getElementById("chat-input").disabled = true;
  document.getElementById("chat-send-btn").disabled = true;
  document.getElementById("chat-status").classList.add("hidden");
}

async function chatSend() {
  const input = document.getElementById("chat-input");
  const msg = input.value.trim();
  if (!msg || !chatSessionId) return;
  input.value = "";
  appendMessage("user", msg);
  showTypingIndicator();
  try {
    await fetch("/api/chat/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatSessionId, content: msg }),
    });
  } catch (_) {
    appendSystemMessage("Failed to send message");
  }
}

// Chat input: Enter to send, Shift+Enter for newline
document.getElementById("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatSend();
  }
});

function appendMessage(role, text) {
  const container = document.getElementById("chat-messages");
  const div = document.createElement("div");
  const isUser = role === "user";
  div.className = `p-3 rounded-xl max-w-[85%] ${
    isUser
      ? "ml-auto bg-accent/40 border border-accent-dark/30"
      : "bg-surface-200 border border-accent-muted"
  }`;
  div.innerHTML = `<div class="text-xs ${isUser ? "text-accent-light" : "text-gray-400"} mb-1">${
    isUser ? "You" : "Agent"
  }</div><div class="text-sm text-gray-200 whitespace-pre-wrap msg-content">${esc(text)}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function appendToMessage(el, text) {
  const content = el.querySelector(".msg-content");
  content.textContent += text;
  el.parentElement.scrollTop = el.parentElement.scrollHeight;
}

function appendThinkBlock(el, text) {
  const content = el.querySelector(".msg-content");
  const details = document.createElement("details");
  details.className =
    "think-block my-2 bg-surface/50 border border-accent-muted rounded-lg overflow-hidden";
  details.innerHTML =
    `<summary class="px-3 py-1.5 text-xs text-accent cursor-pointer hover:bg-surface-200/30 select-none">💭 Thinking…</summary><div class="think-content px-3 py-2 text-xs text-gray-400 whitespace-pre-wrap border-t border-accent-muted">${
      esc(text)
    }</div>`;
  content.appendChild(details);
  el.parentElement.scrollTop = el.parentElement.scrollHeight;
}

function appendSystemMessage(text) {
  const container = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.className = "text-center text-xs text-gray-500 py-2";
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
  removeTypingIndicator();
  const container = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.id = "typing-indicator";
  div.className = "p-3 rounded-xl max-w-[85%] bg-surface-200 border border-accent-muted";
  div.innerHTML =
    '<div class="text-xs text-gray-400 mb-1">Agent</div><div class="typing-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}
