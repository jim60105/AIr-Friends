## 1. Update Session History Table HTML Structure

- [x] 1.1 In `src/dashboard/public/index.html`, add explicit Tailwind width classes to each `<th>` in the Session History table: Session ID (`w-[20%]`), Type (`w-[10%]`), Platform (`w-[10%]`), User (`w-[15%]`), Time (`w-[20%]`), Duration (`w-[10%]`), Status (`w-[15%]`)
- [x] 1.2 Ensure the table container uses `overflow-x-hidden` (not `overflow-x-auto`) to prevent horizontal scrollbar

## 2. Update Session History Row Rendering

- [x] 2.1 In `src/dashboard/public/js/sessions.js`, ensure `pollHistory()` row cells use `break-all` class on Session ID and User ID cells to wrap long monospace content within fixed-width columns
- [x] 2.2 Verify `break-words` class is applied to the Time column cell for proper date-time wrapping

## 3. Verify Responsive Behavior

- [x] 3.1 Manually verify the Session History table renders without horizontal scrollbar on desktop (1920px), tablet (768px), and mobile (375px) viewports
- [x] 3.2 Verify that long Session IDs and User IDs wrap within their cells without causing column overflow
