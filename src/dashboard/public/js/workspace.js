// Workspace browser

async function loadWorkspaceTree() {
  const container = document.getElementById("workspace-tree");
  try {
    const res = await fetch("/api/workspace/tree");
    if (!res.ok) {
      container.innerHTML = '<p class="text-red-400 text-sm">Failed to load</p>';
      return;
    }
    const tree = await res.json();
    container.innerHTML = renderTree(tree);
  } catch (_) {
    container.innerHTML = '<p class="text-red-400 text-sm">Connection error</p>';
  }
}

function renderTree(node) {
  if (!node) return "";
  if (Array.isArray(node)) return node.map(renderTree).join("");
  if (node.type === "directory") {
    const children = (node.children || []).map(renderTree).join("");
    return `<div class="tree-folder">
      <div class="flex items-center gap-1.5 py-1 px-1 hover:bg-surface-200/50 rounded cursor-pointer" onclick="this.parentElement.classList.toggle('collapsed'); this.querySelector('.arrow').classList.toggle('-rotate-90')">
        <span class="arrow text-xs text-gray-500 transition-transform">▾</span>
        <span>📁</span><span class="text-gray-300">${esc(node.name)}</span>
      </div>
      <div class="tree-children ml-4">${children}</div>
    </div>`;
  }
  return `<div class="flex items-center gap-1.5 py-1 px-1 pl-5 hover:bg-surface-200/50 rounded cursor-pointer" onclick="loadFile('${
    esc(node.path)
  }')">
    <span>📄</span><span class="text-gray-300 truncate">${esc(node.name)}</span>
  </div>`;
}

async function loadFile(path) {
  const header = document.getElementById("file-header");
  const content = document.getElementById("file-content");
  header.classList.remove("hidden");
  header.textContent = path;
  content.textContent = "Loading…";
  try {
    const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(path)}`);
    if (!res.ok) {
      content.textContent = `Error: ${res.status}`;
      return;
    }
    const data = await res.json();
    content.textContent = data.content;
  } catch (_) {
    content.textContent = "Failed to load file";
  }
}
