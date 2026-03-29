// Workspace browser

// Disable raw HTML passthrough in marked to prevent XSS
if (typeof marked !== "undefined") {
  marked.use({ renderer: { html: () => "" } });
}

let workspaceTreeData = null;
let treeSortOrder = "alpha"; // "alpha" or "time"

async function loadWorkspaceTree() {
  const container = document.getElementById("workspace-tree");
  try {
    const res = await fetch("/api/workspace/tree");
    if (!res.ok) {
      container.innerHTML = '<p class="text-red-400 text-sm">Failed to load</p>';
      return;
    }
    workspaceTreeData = await res.json();
    renderSortedTree();
  } catch (_) {
    container.innerHTML = '<p class="text-red-400 text-sm">Connection error</p>';
  }
}

function renderSortedTree() {
  const container = document.getElementById("workspace-tree");
  if (!workspaceTreeData) return;
  const sorted = sortTree(JSON.parse(JSON.stringify(workspaceTreeData)), treeSortOrder);
  container.innerHTML = renderTree(sorted);
}

function sortTree(node, order) {
  if (!node || !node.children) return node;
  node.children.forEach((c) => sortTree(c, order));
  node.children.sort((a, b) => {
    const aIsDir = a.type === "directory" ? 0 : 1;
    const bIsDir = b.type === "directory" ? 0 : 1;
    if (aIsDir !== bIsDir) return aIsDir - bIsDir;
    if (order === "time") {
      return (b.mtime || 0) - (a.mtime || 0);
    }
    return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
  });
  return node;
}

function toggleTreeSortOrder() {
  const btn = document.getElementById("workspace-tree-sort-toggle");
  if (treeSortOrder === "alpha") {
    treeSortOrder = "time";
    btn.textContent = "🕒";
    btn.title = "Sorted by time (newest first)";
  } else {
    treeSortOrder = "alpha";
    btn.textContent = "A→Z";
    btn.title = "Sorted alphabetically";
  }
  renderSortedTree();
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("collapsed");
}

function openExpandedFileViewer() {
  const modal = document.getElementById("file-viewer-modal");
  const modalContent = document.getElementById("file-viewer-modal-content");
  const modalPath = document.getElementById("file-viewer-modal-path");
  const rendered = document.getElementById("file-content-rendered");
  const raw = document.getElementById("file-content");
  const path = document.getElementById("file-header-path").textContent;

  modalPath.textContent = path;
  if (!rendered.classList.contains("hidden")) {
    modalContent.innerHTML = rendered.innerHTML;
    modalContent.className = "overflow-auto p-8 text-gray-300 md-rendered bg-surface-100/30";
  } else {
    modalContent.textContent = raw.textContent;
    modalContent.className =
      "overflow-auto p-8 text-[13px] leading-relaxed font-mono text-gray-300 whitespace-pre-wrap";
  }
  modalContent.style.height = "calc(80vh - 60px)";
  modal.classList.remove("hidden");
}

function closeExpandedFileViewer() {
  document.getElementById("file-viewer-modal").classList.add("hidden");
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
  return `<div class="flex items-center gap-1.5 py-1 px-1 pl-5 hover:bg-surface-200/50 rounded cursor-pointer" data-file-path="${
    esc(node.path)
  }">
    <span>📄</span><span class="text-gray-300 truncate">${esc(node.name)}</span>
  </div>`;
}

async function loadFile(path) {
  const header = document.getElementById("file-header");
  const headerPath = document.getElementById("file-header-path");
  const content = document.getElementById("file-content");
  const rendered = document.getElementById("file-content-rendered");
  const toggle = document.getElementById("md-view-toggle");
  const expandBtn = document.getElementById("workspace-file-expand-btn");
  header.classList.remove("hidden");
  headerPath.textContent = path;
  content.textContent = "Loading…";
  rendered.innerHTML = "";
  rendered.classList.add("hidden");
  content.classList.remove("hidden");
  toggle.classList.add("hidden");
  expandBtn.classList.add("hidden");
  try {
    const res = await fetch(`/api/workspace/file?path=${encodeURIComponent(path)}`);
    if (!res.ok) {
      content.textContent = `Error: ${res.status}`;
      return;
    }
    const data = await res.json();
    const isMd = path.endsWith(".md");
    content.textContent = data.content;
    expandBtn.classList.remove("hidden");
    if (isMd && typeof marked !== "undefined") {
      rendered.innerHTML = typeof DOMPurify !== "undefined"
        ? DOMPurify.sanitize(marked.parse(data.content))
        : marked.parse(data.content);
      content.classList.add("hidden");
      rendered.classList.remove("hidden");
      toggle.classList.remove("hidden");
      toggle.textContent = "Raw";
      toggle.dataset.showing = "rendered";
    }
  } catch (_) {
    content.textContent = "Failed to load file";
  }
}

function toggleMarkdownView() {
  const content = document.getElementById("file-content");
  const rendered = document.getElementById("file-content-rendered");
  const toggle = document.getElementById("md-view-toggle");
  if (toggle.dataset.showing === "rendered") {
    rendered.classList.add("hidden");
    content.classList.remove("hidden");
    toggle.textContent = "Rendered";
    toggle.dataset.showing = "raw";
  } else {
    content.classList.add("hidden");
    rendered.classList.remove("hidden");
    toggle.textContent = "Raw";
    toggle.dataset.showing = "rendered";
  }
}

// Delegated click handler for workspace file items
document.getElementById("workspace-tree").addEventListener("click", (e) => {
  const fileItem = e.target.closest("[data-file-path]");
  if (fileItem) {
    loadFile(fileItem.dataset.filePath);
  }
});
