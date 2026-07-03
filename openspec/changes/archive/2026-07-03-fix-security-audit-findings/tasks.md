## 1. F1 — Agent subprocess environment isolation

- [x] 1.1 In `src/acp/agent-connector.ts`, add `clearEnv: true` to the `Deno.Command` options in `connect()`, keeping `env: agentConfig.env`
- [x] 1.2 Verify `src/acp/agent-factory.ts` builds a complete env (PATH, HOME, TMPDIR, DENO_DIR, LANG, LC_ALL, USER, SESSION_ID, AGENT_WORKSPACE, agent-specific vars); add any variable the agent actually needs that was previously inherited
- [x] 1.3 Add spawn-level tests in `tests/acp/`: (negative) set a fake parent secret via `Deno.env.set`, spawn the agent (or a stub command printing its env), assert the fake secret is ABSENT from the child's real environment; (positive) assert required vars (`PATH`, `HOME`, `TMPDIR`, `SESSION_ID`, `AGENT_WORKSPACE`, and OpenCode provider keys) ARE present after `clearEnv`
- [x] 1.4 Run existing ACP/integration tests to confirm no agent relied on an inherited variable

## 2. F2 — Entrypoint-anchored command whitelist matching

- [x] 2.1 In `src/acp/client.ts`, rewrite `matchesScriptPath` to require the interpreter (`deno`) as the first token and the whitelisted script path as the entrypoint positional (first non-flag token after `run`), instead of `tokens.some(...)`
- [x] 2.2 Verify whether any surviving OpenCode skill is command-prefix based; if none, remove `matchesCommandPrefix` from restricted-mode auto-approval entirely (interpreter+entrypoint only). If retained, tighten it so subsequent tokens cannot reference paths outside the workspace
- [x] 2.3 Add unit tests: legitimate `deno run <flags> <script> <args>` approved; `cat /home/deno/.git-credentials <script>` and `tar … <script>` rejected; prefix skill with out-of-workspace path arg rejected (if prefix matching retained)
- [x] 2.4 Confirm the matcher contract matches the real skill invocation form used by the orchestrator for OpenCode
- [x] 2.5 Verify and align restricted-mode skill-directory read approval path (`client.ts:318-345` references `/home/deno/.copilot/skills`) with the OpenCode-effective discovery path (`~/.agents/skills`, repo `skills/`); add an OpenCode skill-discovery/read-approval test using the actual configured path (or document why unrelated)

## 3. F3 — Agent workspace write gating + egress removal

- [x] 3.1 Add `canWriteAgentWorkspace?: boolean` to `ClientConfig` in `src/acp/types.ts`
- [x] 3.2 In `src/core/session-orchestrator.ts`, thread `canWriteAgentWorkspace` into the `ClientConfig` passed to the ACP client, setting it `true` ONLY for self-research sessions (already `true` in template vars at `session-orchestrator.ts:2782`); leave unset/false for user, spontaneous, channel-lurk, AND memory-maintenance sessions (memory-maintenance writes per-user memory via skills, not the shared workspace)
- [x] 3.3 In `src/acp/client.ts`, enforce `canWriteAgentWorkspace` for agent-workspace paths in BOTH the `requestPermission` edit/write branch (`~:427-495`) and the `writeTextFile` handler (`~:698-743`) (TMPDIR writes remain allowed)
- [x] 3.4 Remove `curl *` and `wget *` from the restricted-mode `bash` allow map in `agent-config/opencode.json`
- [x] 3.5 Add tests: ordinary session write rejected; memory-maintenance session write rejected; self-research session write approved; TMPDIR write approved regardless of flag; write rejected via direct `writeTextFile` (not just `requestPermission`)
- [x] 3.6 Update `AGENTS.md` / prompt notes to reflect that ordinary sessions have read-only agent-workspace access and that curl/wget are no longer auto-approved

## 4. F4 — Boundary-safe path validation

- [x] 4.1 In `src/acp/client.ts`, add an `isWithinDir(path, base)` helper returning `resolved === base || resolved.startsWith(base + SEP)` (using the platform separator)
- [x] 4.2 Replace the `startsWith` checks in `isPathAllowed`, `isAgentWorkspacePath`, and `isWithinTmpDir` with `isWithinDir`
- [x] 4.3 Add an explicit read-extension allowlist to `readTextFile` (`.jsonl`, `.md`, `.txt`) — do NOT reuse the write allowlist (`.md`/`.txt`), which would block memory JSONL reads
- [x] 4.4 Add tests: sibling-prefix path (`/…/1234` vs base `/…/123`) rejected for read/write; genuine subpath accepted; `memory.public.jsonl` read allowed; disallowed read extension (e.g. `.json`) rejected

## 5. F5 — Dashboard login rate-limit hardening

- [x] 5.1 In `src/dashboard/server.ts`, derive the login rate-limit key from `info.remoteAddr` instead of `X-Forwarded-For`
- [x] 5.2 Honor `X-Forwarded-For` only when the real connection address is in `dashboard.trustedProxies`; normalize both the socket address and configured entries to a canonical host string (strip port, normalize IPv4/IPv6) before exact matching
- [x] 5.3 In `src/dashboard/auth.ts`, add a global failed-attempt counter with backoff independent of the per-IP key
- [x] 5.4 In `src/core/config-loader.ts`, enforce a minimum passphrase length (≥ 16) when the dashboard is enabled; fail startup with `ConfigError` otherwise
- [x] 5.5 Add tests: header rotation counted against real IP; trusted-proxy XFF honored (IPv4, IPv6); global backoff caps attempts; weak passphrase rejected at load

## 6. F6 — Misskey attachment SSRF validation

- [x] 6.1 Add a `validateFetchUrl(url)` utility that enforces http/https scheme, resolves DNS, and rejects loopback/private/link-local/ULA/unspecified/multicast addresses
- [x] 6.2 Enforce validation at the authoritative fetch sink: call `validateFetchUrl` immediately before EVERY `fetch(att.url)` in `src/core/session-orchestrator.ts`'s image downloader (regardless of attachment source), using `redirect: "manual"` with per-hop re-validation and a max of 5 hops
- [x] 6.3 Optionally apply the same validation at Misskey attachment ingestion in `src/platforms/misskey/misskey-utils.ts` as defense-in-depth (not a substitute for the sink check)
- [x] 6.4 On validation failure, fall back to URL-only text description without throwing
- [x] 6.5 Add tests at the downloader boundary: loopback, link-local metadata IP, non-http scheme, and redirect-to-internal all rejected; redirect chain beyond 5 hops aborted; valid public URL fetched

## 7. F7 — Scope edit-reply to session's last message

- [x] 7.1 In `src/skills/reply-handler.ts`, reject `handleEditReply` when `params.messageId !== context.lastSentMessageId`
- [x] 7.2 Confirm the Skill API updates the tracked `lastSentMessageId` to the new returned ID after a successful edit (`skill-api/server.ts:419-424`) so successive Misskey edits work
- [x] 7.3 Add tests: edit-reply on a foreign `messageId` rejected (no delete/edit); edit-reply on the matching last-sent message proceeds (Discord edit; Misskey delete-and-recreate); TWO consecutive Misskey edits in one session both succeed

## 8. F8 — Dashboard configurable bind host

- [x] 8.1 Add `host` (default `127.0.0.1`) to the dashboard config type in `src/types/config.ts` and loader defaults in `src/core/config-loader.ts`
- [x] 8.2 Pass `{ hostname: config.dashboard.host }` to `Deno.serve` in `src/dashboard/server.ts`
- [x] 8.3 Add tests: default bind is `127.0.0.1`; explicit `0.0.0.0` honored

## 9. F10 — Config-driven Secure cookie flag

- [x] 9.1 Add `behindHttpsProxy` (default `false`) to the dashboard config type and loader
- [x] 9.2 In `src/dashboard/auth.ts`/`server.ts`, set the `Secure` cookie flag from `behindHttpsProxy` (or a genuine TLS connection), not from `X-Forwarded-Proto` alone
- [x] 9.3 Add tests: Secure set when `behindHttpsProxy: true`; not set from spoofed `X-Forwarded-Proto` when `false`

## 10. F11 — Misskey specified notes classified as DM

- [x] 10.1 In `src/platforms/misskey/misskey-adapter.ts`, derive `isDm` from note visibility (`specified` → `true`) in the mention handler instead of hardcoding `false`
- [x] 10.2 Add tests: `specified` note normalized with `isDm: true`; reply policy in `public` mode denies a non-whitelisted `specified` note; reply visibility remains `specified`

## 11. Configuration surface & docs

- [x] 11.1 Add `dashboard.host`, `dashboard.behindHttpsProxy`, `dashboard.trustedProxies` to `config.example.yaml`
- [x] 11.2 Add `DASHBOARD_HOST`, `DASHBOARD_BEHIND_HTTPS_PROXY`, `DASHBOARD_TRUSTED_PROXIES` to `.env.example` and wire env-var overrides in `src/utils/env.ts` / `config-loader.ts`
- [x] 11.3 Add the new dashboard fields to `helm/values.yaml` under `env:`
- [x] 11.4 Update `AGENTS.md` dashboard/security sections to document the new fields and defaults

## 12. Deferred / future-work notes (documentation only)

- [x] 12.1 Record in the change/design notes that GitHub Copilot and Gemini CLI agents and their agent-specific security layers (`--deny-tool`, Gemini policy engine) are to be removed in a separate future change; F2's Copilot/Gemini blast-radius mitigations become moot then
- [x] 12.2 Record that F9 (reply-cap TOCTOU, LOW) is accepted-for-now and not fixed in this change
- [x] 12.3 Decide (Open Question) whether to constrain `handleChatConnect` (`dashboard/server.ts:551-554`) and `getDefaultAgentType` fallback (`agent-factory.ts:259-263`) to reject non-OpenCode agent types now, so this change's closure claims are not overstated while agent removal is deferred; if not constrained, document the OpenCode-scoped caveat in the changelog

## 13. Verification

- [x] 13.1 Run `deno fmt src/ tests/` and `deno lint src/ tests/`
- [x] 13.2 Run `deno check src/main.ts`
- [x] 13.3 Run `deno task test` and confirm coverage ≥ 75%
- [x] 13.4 Run `openspec validate fix-security-audit-findings` and confirm it passes
