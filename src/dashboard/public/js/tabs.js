// Tab navigation

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
  document.getElementById("tab-" + tab).classList.remove("hidden");
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle("bg-surface", active);
    b.classList.toggle("text-accent-light", active);
    b.classList.toggle("border-b-2", active);
    b.classList.toggle("border-accent", active);
    b.classList.toggle("text-gray-400", !active);
    b.classList.toggle("hover:text-gray-200", !active);
  });
  if (tab === "workspace") loadWorkspaceTree();
  if (tab === "channel-memory") loadChannelMemoryChannels();
}
