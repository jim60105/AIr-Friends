## Why

AIr-Friends has no human in the loop: the ACP permission gate in `src/acp/client.ts` (`requestPermission` → `matchesCommandPrefix` / `referencesOutOfWorkspacePath`) *is* the security boundary that keeps untrusted chat input from reading files it should not. Security audit run-2 (finding F12, CRITICAL) established — by reading OpenCode's actual source (`anomalyco/opencode`, `permission/index.ts:67-107`) and corroborated by the repo's own `docs/AGENT_PERMISSIONS.md:147` — that this boundary **never executes** for the tools that matter. OpenCode evaluates its own permission map (`agent-config/opencode.json`) first; an `"allow"` verdict self-authorizes the tool call and returns *before* any `session/request_permission` is sent to the ACP client. Only `"ask"` reaches `client.ts`, and the shipped config sets `head`/`tail`/`ls`/`find`/`cat`/`agent-browser` bash entries to `"allow"`. So any Discord/Misskey user can have the bot run `head -c 2000 /proc/1/environ` (PID 1 is `dumb-init`, inheriting the container env) and read back the daemon's `DISCORD_TOKEN`, `MISSKEY_TOKEN`, `OPENROUTER_API_KEY`, and dashboard passphrase — full bot + dashboard takeover — or `head /app/data/workspaces/discord/<victimId>/memory.private.jsonl` to read any other user's private memory. The agent and daemon share UID 1000, so these paths are readable.

## What Changes

- **Make the ACP gate authoritative for *every* self-authorizing bash tool, not a curated few.** The restricted profile allow-lists ~28 bash utilities (`opencode.json:46-91`), and many beyond `head`/`cat` are equally-capable arbitrary-file-read primitives — `rg -a "" /proc/1/environ`, `jq -Rs . /proc/1/environ`, `pandoc … -t plain`, `exiftool`, ImageMagick's `label:@`/`-verbose` coders, `pdftotext`, and `zip`/`unzip` round-trips. Change **all** of these filesystem-touching entries (`agent-browser`, `rg`, `cat`, `head`, `tail`, `ls`, `find`, `wc`, `file`, `tree`, `jq`, `pdftotext`/`pdfinfo`/`pdfimages`/`pdftoppm`, `pandoc`, `exiftool`, `ffmpeg`/`ffprobe`, `magick`/`convert`/`identify`/`mogrify`, `unzip`/`zip`/`7zz`, and `bc`/`zola` if kept) from `"allow"` to `"ask"`, so OpenCode forwards the decision to `client.ts` instead of self-authorizing. Flipping only the obvious five would leave the finding wide open.
- **Extend the restricted-mode execute branch so `"ask"` does not break legitimate use.** Today `client.ts`'s execute branch auto-approves only *registered-skill* command prefixes and default-rejects everything else; flipping the bash entries to `"ask"` alone would auto-DENY every legitimate in-workspace use the agent needs. Add a **generic-command allow-list** (exactly the utility set above) that `requestPermission` approves **only when every path argument — input *and* output — resolves inside the session workspace/TMPDIR**, and rejects otherwise. All-path-args gating matters because several of these tools also write (media conversion, archive extraction), so an out-of-workspace *output* target must be rejected too.
- **Reject URI schemes in path arguments.** `referencesOutOfWorkspacePath` is scheme-blind, so `agent-browser open file:///etc/passwd` slips past it (its own doc comment cites this exact threat). Add a URI-scheme check so `file://`, and any `scheme://` token, is treated as out-of-workspace.
- **Confine the agent's filesystem view so a gate regression is not catastrophic (defense-in-depth).** The agent subprocess SHALL NOT be able to read `/proc/1/environ` (daemon secrets) or other users' workspace directories, independent of the permission layer. Because the container runs unprivileged as a single UID (OpenShift arbitrary-UID model), naive `Deno.Command({ uid })` separation is not available; the durable fix is a filesystem-confinement wrapper (mount-namespace / Landlock) or a two-account container — see `design.md` for the decision and trade-offs.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `acp-integration`: restricted-mode `requestPermission` SHALL be the authoritative gate for generic file-reading bash commands — approving them only when their path arguments resolve inside the session workspace/TMPDIR — and `referencesOutOfWorkspacePath` SHALL treat any `scheme://` URI token as out-of-workspace.
- `agent-sandbox-hardening`: the agent permission map SHALL route file-reading bash tools through the ACP gate rather than self-authorizing them at the agent layer; and the agent subprocess SHALL run under a filesystem confinement that prevents reading `/proc/1/environ` and other users' workspace directories even if the permission gate is misconfigured.

## Impact

- **Config:** `agent-config/opencode.json` (bash `head`/`tail`/`ls`/`find`/`cat` and `agent-browser` `"allow"` → `"ask"`).
- **Code:** `src/acp/client.ts` (generic read-command allow-list in the execute branch keyed on in-workspace path args; `referencesOutOfWorkspacePath` URI-scheme rejection). Filesystem confinement touches the agent spawn path (`src/acp/agent-connector.ts` / `agent-factory.ts`) and/or the `Containerfile` entrypoint — decided in `design.md`.
- **Docs:** `docs/AGENT_PERMISSIONS.md` (the Layer-2/Layer-3 relationship and the fact that `"allow"` bypasses Layer 3 must be corrected; document the generic read-command allow-list).
- **Tests:** new tests under `tests/acp/` proving `head /proc/1/environ` and `head <other-user-workspace>` are rejected while in-workspace `head`/`cat`/`ls` are approved, and `agent-browser open file:///etc/passwd` is rejected.
- **Cross-references:** this change closes the read primitive that finding F13 (Skill API impersonation) and F14 (network egress) depend on for reachability; those changes address their own application-layer defenses independently.
- **Not addressed here:** the YOLO agent profile (`opencode.json:105` `"*": "allow"`) is out of scope — YOLO is an explicit operator opt-out of the gate; F12 concerns the *default* restricted profile.
