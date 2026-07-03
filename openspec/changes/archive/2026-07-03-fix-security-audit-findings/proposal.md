## Why

A security audit (run-1) of AIr-Friends found one systemic sandbox failure and several permission-model gaps that are exploitable via prompt injection from untrusted chat — which is precisely this application's threat model (untrusted chat input drives a shell-capable AI agent with automated, non-human approval). The most serious issue is that the agent-subprocess environment filter the docs advertise as isolating provider secrets is a runtime no-op: `Deno.Command` merges the supplied env with the parent's, so the agent inherits every secret the bot holds. Combined with path-boundary and command-whitelist gaps, a prompt-injecting user can plausibly exfiltrate all credentials. These are correctness/enforcement bugs, not merely hardening gaps, and must be fixed before wider deployment.

Because the project is pre-release with zero production users, we take this opportunity to also collapse the multi-agent surface: OpenCode becomes the single supported ACP agent, and the Copilot/Gemini-specific fixes are deferred as future work (documented, not implemented here).

## What Changes

- **F1 (HIGH) — Env isolation is a no-op.** Set `clearEnv: true` on the agent `Deno.Command` spawn so the child receives only the explicitly-built allowlisted env, not the parent's inherited secrets. Add a spawn-level test asserting a fake parent secret is absent from the child's real environment.
- **F2 (HIGH) — Command-whitelist bypass via arbitrary first token.** Anchor `matchesScriptPath` to the actual invocation entrypoint (require a known interpreter as the first token and the whitelisted script as the entrypoint positional) instead of matching the script path as *any* token. Constrain `matchesCommandPrefix` so a whitelisted prefix cannot smuggle attacker-controlled path arguments. **Note:** the Copilot `--deny-tool` and Gemini policy-engine layers that this gap most severely affected are being removed alongside those agents; the ACP-gate hardening here is the enforcement layer that remains for OpenCode.
- **F3 (HIGH) — Cross-user stored prompt injection via shared agent-workspace notes.** Thread the existing `canWriteAgentWorkspace` flag (already set for self-research sessions in `session-orchestrator.ts`, but currently only a prompt-template variable) into `ClientConfig` and **enforce** it in `requestPermission`/`writeTextFile` so only self-research sessions may write shared notes; ordinary user, spontaneous, channel-lurk, and memory-maintenance sessions get read-only access. Remove the blanket `curl`/`wget` allow from OpenCode restricted-mode permissions (or require network isolation) to close the egress leg of the exfiltration chain.
- **F4 (HIGH) — Path-boundary escape via `startsWith` prefix match.** Replace the prefix checks in `isPathAllowed`, `isAgentWorkspacePath`, and `isWithinTmpDir` with boundary-safe comparison (`p === base || p.startsWith(base + sep)`), reusing the `relative()`-based validation pattern. Add an extension check to `readTextFile`.
- **F5 (MEDIUM) — Dashboard login brute-force via attacker-controlled `X-Forwarded-For`.** Derive the login rate-limit key from the real connection address (`info.remoteAddr`) unless a trusted-proxy allow-list is configured; add a global failed-attempt/backoff counter; enforce a minimum passphrase length/entropy at config load.
- **F6 (MEDIUM) — Misskey image-attachment SSRF.** Validate attachment URLs before the server-side `fetch`: scheme allow-list (http/https), DNS resolution with rejection of private/loopback/link-local/ULA ranges, and `redirect: "manual"` with per-hop re-validation.
- **F7 (MEDIUM) — Misskey `edit-reply` accepts unscoped `messageId`.** Reject `edit-reply` when `params.messageId !== context.lastSentMessageId` so a session cannot delete/recreate arbitrary bot-authored notes from other conversations. The Skill API already updates the session's tracked `lastSentMessageId` after a successful edit (`server.ts:419`), so successive in-session edits (including Misskey's new-ID-after-delete) continue to work.
- **F8 (MEDIUM) — Dashboard binds `0.0.0.0` with no host option.** Add a `dashboard.host` config field defaulting to `127.0.0.1` and pass it to `Deno.serve`; require explicit opt-in for `0.0.0.0`.
- **F10 (LOW) — `Secure` cookie gated on attacker-controlled `X-Forwarded-Proto`.** Tie the `Secure` cookie flag to an explicit `dashboard.behindHttpsProxy` config flag rather than a spoofable request header.
- **F11 (LOW) — Misskey `specified` notes misclassified as non-DM.** Derive `isDm` from note visibility so `specified`-visibility notes are treated as DMs and correctly gated by reply policy.
- **F9 (LOW, deferred to design note only) — reply-cap TOCTOU** and the **Copilot/Gemini removal** are addressed as documented future/adjacent work; see design.md.

## Capabilities

### New Capabilities

- `agent-sandbox-hardening`: Enforcement guarantees for the agent subprocess sandbox — environment isolation via `clearEnv`, entrypoint-anchored command-whitelist matching, boundary-safe path validation, and `canWriteAgentWorkspace` write-gating for the shared agent workspace.

### Modified Capabilities

- `acp-integration`: `AgentConnector` subprocess spawn SHALL clear the parent environment; restricted-mode permission handling SHALL anchor command matching to the invocation entrypoint, enforce `canWriteAgentWorkspace` for agent-workspace writes, use boundary-safe path checks, and apply an extension check on `readTextFile`.
- `workspace-trust-boundary`: agent-workspace writes SHALL be gated by session write-permission; path-boundary checks SHALL reject sibling-prefix escapes.
- `dashboard-security-hardening`: login rate limiting SHALL key on the real connection address (not a spoofable header) with a global backoff; the `Secure` cookie flag SHALL be config-driven; a minimum passphrase strength SHALL be enforced.
- `web-dashboard-server`: the dashboard SHALL bind to a configurable host defaulting to `127.0.0.1`.
- `multimedia-messages`: attachment URLs SHALL be validated against SSRF (scheme/IP/redirect checks) before server-side download.
- `skills-and-reply`: `edit-reply` SHALL only operate on the session's own last-sent message.
- `platform-abstraction`: Misskey `specified`-visibility notes SHALL be classified as DMs.
- `configuration-and-deployment`: new config fields (`dashboard.host`, `dashboard.behindHttpsProxy`, dashboard trusted-proxy / passphrase-strength settings) with env-var overrides and example-file updates.

## Impact

- **Code:** `src/acp/agent-connector.ts` (clearEnv), `src/acp/client.ts` (matchers, path checks, write-gating, readTextFile), `src/acp/types.ts` + `src/core/session-orchestrator.ts` (thread `canWriteAgentWorkspace`), `agent-config/opencode.json` (remove curl/wget allow), `src/dashboard/server.ts` + `src/dashboard/auth.ts` (rate-limit key, host bind, secure cookie), `src/core/config-loader.ts` (passphrase strength, new fields), `src/platforms/misskey/misskey-utils.ts` + `src/core/session-orchestrator.ts` (SSRF validation), `src/skills/reply-handler.ts` (edit-reply scoping), `src/platforms/misskey/misskey-adapter.ts` (isDm classification).
- **Config/docs:** `config.example.yaml`, `.env.example`, `helm/values.yaml`, `AGENTS.md`.
- **Tests:** new/updated tests under `tests/acp/`, `tests/dashboard/`, `tests/platforms/misskey/`, `tests/skills/`, `tests/core/`.
- **Deferred (future task, not in this change):** removal of GitHub Copilot and Gemini CLI agents and their agent-specific security layers (`--deny-tool`, Gemini policy engine); F2's Copilot/Gemini-specific blast-radius mitigations become moot once those agents are removed. F9 (reply-cap TOCTOU, LOW) is documented but not fixed here.
