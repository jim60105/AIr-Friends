## Context

The current web dashboard UI is functional but lacks a modern, cohesive design. It has been described as "quite ugly." We need to refresh the UI/UX to make it more appealing and user-friendly without altering any of the underlying backend endpoints, logic, or behavioral specifications.

## Goals / Non-Goals

**Goals:**
- Implement a modern, clean, and consistent visual aesthetic across all dashboard views.
- Improve UX through better layout, spacing, and typography.
- Retain all existing functionality (chat, session monitor, agent workspace browser, etc.).
- Follow established frontend design guidelines and secure coding practices.

**Non-Goals:**
- No changes to API endpoints, payloads, or backend logic.
- No changes to existing behavioral specifications or requirements.
- No new features or capabilities.

## Decisions

- **Styling Approach:** Update the existing CSS and HTML structures in `src/dashboard/public/` and `src/dashboard/server.ts` to implement a modern design system.
- **Frontend Design Guidelines:** We will follow the principles outlined in `.agents/skills/frontend-design/SKILL.md` and `~/copilot-prompt/instructions/web-design-guideline.instructions.md`.
- **Vanilla CSS / Existing Tools:** Use the project's existing build tools and CSS strategy rather than introducing heavy new frontend frameworks like React or Tailwind, ensuring minimal disruption to the build pipeline while achieving the visual refresh.

## Risks / Trade-offs

- **Risk:** Unintentional breakage of existing functionality due to DOM structure changes.
  - **Mitigation:** Ensure all IDs and data attributes used by the client-side JavaScript remain intact. Thoroughly test the UI changes against existing functionalities.
