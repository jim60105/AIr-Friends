## 1. Tailwind Config Update

- [x] 1.1 Update `surface` color palette in `index.html` Tailwind config: `DEFAULT` → `#1e1e1e`, `50` → `#252526`, `100` → `#2d2d30`, `200` → `#3c3c3c`
- [x] 1.2 Add custom `accent` color palette to Tailwind config: `DEFAULT` → `#007acc`, `light` → `#3794ff`, `dark` → `#0e639c`, `muted` → `rgba(0, 122, 204, 0.15)`

## 2. HTML Accent Color Migration

- [x] 2.1 Replace all `indigo-*` Tailwind class references in `index.html` with corresponding `accent-*` classes (e.g., `indigo-600` → `accent-dark`, `indigo-300` → `accent-light`, `indigo-900/40` → `accent-muted`)
- [x] 2.2 Update text color classes (`gray-200`, `gray-300`, `gray-400`) to use `text-[#cccccc]` or `text-[#d4d4d4]` where visible on surface backgrounds
- [x] 2.3 Update body class `text-gray-200` to `text-[#cccccc]`

## 3. CSS Hardcoded Color Updates

- [x] 3.1 Update scrollbar colors: track `#1e1b2e` → `#2d2d30`, thumb `#4338ca` → `#007acc`, thumb hover `#6366f1` → `#3794ff`
- [x] 3.2 Update markdown heading colors to VSCode foreground shades (`#d4d4d4`, `#cccccc`, `#c0c0c0`, `#b0b0b0`)
- [x] 3.3 Update markdown inline code bg `#252236` → `#3c3c3c` and pre bg `#1a1726` → `#252526`
- [x] 3.4 Update blockquote border `#4338ca` → `#007acc` and text color `#9896a8` → `#9e9e9e`
- [x] 3.5 Update link colors: `#818cf8` → `#3794ff`, hover `#a5b4fc` → `#4dabf5`
- [x] 3.6 Update border/hr colors from `rgba(99, 102, 241, ...)` to `rgba(0, 122, 204, ...)`
- [x] 3.7 Update table header bg `#1a1726` → `#252526` and heading color `#c8c6d4` → `#cccccc`
- [x] 3.8 Update typing indicator dot color `#818cf8` → `#3794ff`

## 4. Verification

- [x] 4.1 Grep for any remaining `indigo` references in `index.html` and `style.css` — must be zero
- [x] 4.2 Grep for any remaining old purple hex values (`#0f0d1a`, `#1a1726`, `#1e1b2e`, `#252236`, `#4338ca`, `#6366f1`, `#818cf8`) — must be zero
- [x] 4.3 Visual check that dashboard loads correctly with new theme
