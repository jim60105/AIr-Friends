# Proposal

## Why

The dashboard chat endpoint accepts both agent types, but its selector offers only OpenCode and always submits that explicit choice. Users cannot select OMP through the supported dashboard surface.

## What Changes

- Add OMP to the existing chat agent selector alongside OpenCode.
- Forward the selected value through the current connection request without a hard-coded OpenCode override.
- Preserve current initial selection, model entry, API default handling, authentication, and lifecycle behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-dashboard-chat`: Require UI selection and request forwarding for both supported agent types.

## Impact

Targets: `src/dashboard/public/index.html`, existing `js/chat.js` behavior if needed, and consumer-visible dashboard selection coverage. The backend already supports OMP; no new endpoint or config field. Independent of policy corrections, listed last only for single-writer application. Budget: 2.0h including a throwaway browser smoke, existing test adjustment where behavior changes, docs, and changelog. No real ACP agent/provider launch for automated acceptance.
