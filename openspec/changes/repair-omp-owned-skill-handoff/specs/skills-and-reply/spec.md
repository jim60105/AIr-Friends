# Spec Delta

## MODIFIED Requirements

### Requirement: Shell-Based Skill Execution

Skills SHALL be implemented as Deno TypeScript scripts in `skills/{skill-name}/scripts/`, each with a `SKILL.md` describing its usage, and SHALL be executed with a `--session-id` parameter while using the shared client library at `skills/lib/client.ts` to communicate back to the main bot via HTTP.

#### Scenario: Agent executes a skill script
- **GIVEN** an ACP Agent decides to use the `memory-save` skill
- **WHEN** the agent executes the script
- **THEN** the script SHALL receive `--session-id` as a parameter
- **AND** the script SHALL call the Skill API HTTP endpoint to perform the operation

#### Scenario: Skill receives session ID from environment variable (per-spawn mode)
- **GIVEN** a legacy per-spawn skill caller using environment-backed session identity
- **WHEN** it invokes the script with `--session-id "$SESSION_ID"`
- **THEN** existing per-spawn environment resolution SHALL remain compatible
- **AND** current bundled recipes SHALL instead pass the literal session id rendered in the prompt
- **AND** shared-process identity SHALL remain resolved by the authoritative current-session pointer, not a process-frozen environment value

#### Scenario: Shared-mode process environment carries no session identity variable
- **GIVEN** a shared-process (pool) agent process is spawned while serving session `sess_A`
- **WHEN** session `sess_B` later runs on the same process and the agent inspects its shell environment
- **THEN** `SESSION_ID` SHALL be absent from the environment
- **AND** any skill invocation SHALL resolve the owning session `sess_B` from the current-session pointer without agent involvement

#### Scenario: Unresolvable shared-mode identity fails loud
- **GIVEN** shared-process mode and a current-session pointer that is absent (lease ended)
- **WHEN** a skill script resolves the owning session
- **THEN** the library SHALL exit non-zero with a `SKILL_SESSION_UNRESOLVED` structured error naming the expected pointer path and the "invoke skills during a live turn" remedy
- **AND** the Skill API SHALL NOT be called

#### Scenario: Owning session resolved without agent work (shared mode)
- **GIVEN** a shared channel process running sessions for a channel
- **WHEN** a skill script invokes the shared client library
- **THEN** the library SHALL resolve the owning session id from the current-session pointer file (written only while that session holds the execution lease) and present that session's JWT
- **AND** the agent SHALL NOT need to read files or pass extra CLI arguments
- **AND** the script SHALL snapshot the session id and JWT at script start, so a backgrounded subprocess cannot observe a later session's pointer or JWT file

#### Scenario: Legacy free-text flag rejected
- **GIVEN** a skill script that sends or stores user-facing content (e.g. `send-reply`)
- **WHEN** the script is invoked with a legacy free-text flag such as `--message "定價 $0.435"` or `--message=定價 $0.435`
- **THEN** the script SHALL exit with a non-zero status and an error instructing the use of the payload-file flag (e.g. `--message-file`)
- **AND** the script SHALL NOT call the Skill API

#### Scenario: Free-text content stays off the command line
- **GIVEN** a skill script that carries free-text content (reply text, memory content, search queries, captions, reminder text)
- **WHEN** the script is invoked
- **THEN** the script SHALL NOT accept any free-text argument as a CLI value in any form
- **AND** any free-text argument SHALL be passed via a payload-file flag (e.g. `--message-file`, `--content-file`, `--query-file`, `--caption-file`) whose content is read from a file staged in the session-scoped TMPDIR, so no user-facing content ever appears on a shell command line

#### Scenario: Legacy free-text flags rejected in both forms
- **GIVEN** a skill script invoked with a legacy free-text flag (`--message`, `--content`, `--query`, or `--caption`)
- **WHEN** the flag is given in either form (`--flag value` or `--flag=value`)
- **THEN** the script SHALL exit non-zero with a clear error and SHALL NOT call the Skill API

#### Scenario: Owning session identity resolved without extra agent work
- **GIVEN** a skill script executed by the agent
- **WHEN** the shared client library resolves the owning session id
- **THEN** in per-spawn mode it SHALL resolve from the `SESSION_ID` environment variable, and in shared-process mode from the orchestrator-maintained current-session pointer file (written ONLY while the session holds the global execution lease via an atomic temp-file+rename write, and cleared on release)
- **AND** the library SHALL present the owning session's JWT, so in neither mode SHALL the agent need to read files or pass extra parameters

#### Scenario: Shared-mode pointer is the sole identity source
- **GIVEN** shared-process mode where the agent process environment SHALL NOT contain `SESSION_ID` (a spawn-time frozen value would name a different session)
- **WHEN** a skill script resolves its owning session
- **THEN** the pointer SHALL be the sole identity source and the library SHALL NOT fall back to any environment value
- **AND** when the pointer is unreadable or malformed (`sessionId` must be a non-empty string), the library SHALL fail with a stable `SKILL_SESSION_UNRESOLVED` structured error carrying the code in a machine-readable `code` field

#### Scenario: Session ID is advisory in shared-process mode
- **GIVEN** shared-process mode
- **WHEN** a skill script is invoked with an arbitrary `--session-id` value
- **THEN** the library SHALL substitute the pointer-resolved owning session in the API request body so the server's JWT `sub` check stays authoritative

#### Scenario: Skill snapshots identity at start
- **GIVEN** a skill script that runs or may outlive the current turn
- **WHEN** the script starts
- **THEN** it SHALL snapshot the owning session id and the JWT file content ONCE at script start, so a backgrounded or late-running skill subprocess cannot observe a later session's pointer or JWT file

#### Scenario: Skill scripts run with scoped Deno permissions
- **GIVEN** a skill script is executed directly
- **WHEN** it is run
- **THEN** it SHALL use the shebang `#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write`
- **AND** `--allow-read` SHALL be required for reading the staged payload file and the per-session JWT file, and `--allow-write` SHALL enable the script's best-effort deletion of the consumed payload file

#### Scenario: SKILL.md describes the session-id source truthfully
- **GIVEN** a skill's `SKILL.md`
- **WHEN** it documents the session-id source
- **THEN** it SHALL state that the session id rendered in the system prompt is authoritative, and that `$SESSION_ID` is present only in per-spawn deployments

### Requirement: Agent-Portable Staging And Session Identity

Every prompt surface that instructs skill usage SHALL supply the literal active Skill API session id, trusted absolute skill-script root, and the absolute session staging directory (`{session workspace}/tmp/{literalSkillSessionId}`, the canonical payload staging location independent of any process-level `TMPDIR`), and every payload-staging instruction from those prompts and the skill instruction files SHALL direct the agent to those literal absolute paths, never to `$TMPDIR`/`$SESSION_ID` shell tokens.

#### Scenario: Rendered prompts name literal id and absolute staging dir
- **GIVEN** a session with Skill API id `sess_42` whose staging directory is `/abs/workspaces/discord/123/tmp/sess_42`
- **WHEN** any payload-staging prompt (system prompt, retry prompt, summary prompt) is rendered for that session
- **THEN** the rendered text SHALL contain the literal `sess_42` and the absolute directory `/abs/workspaces/discord/123/tmp/sess_42`
- **AND** the payload-file/structured-file-tool instructions in the rendered text SHALL contain NO `$TMPDIR` or `$SESSION_ID` token

#### Scenario: Pooled session gets the same literal contract as per-spawn
- **GIVEN** a shared-process (pooled, `SKILL_SHARED_PROCESS=1`) deployment whose process environment has NO `SESSION_ID` variable and a channel-scoped process `TMPDIR`
- **WHEN** a session's prompt and (if needed) its retry prompt are rendered and delivered
- **THEN** the prompts SHALL name that session's own literal Skill API id and its own absolute staging directory
- **AND** the agent's staged payload → script invocation SHALL resolve to the owning session's staging directory without any process-frozen identity

#### Scenario: End-to-end mocked delivery in both spawn shapes
- **GIVEN** a mocked platform and the REAL Skill API handler and reply-handler logic
- **WHEN** a per-spawn session and a pooled session each stage a payload at the prompt-rendered absolute path and invoke `send-reply` through the real script payload contract
- **THEN** exactly the intended reply SHALL be recorded for each session with NO duplicate retry or fallback delivery
- **AND** the staging path consumed by the handler SHALL be the same absolute directory the prompt named

#### Scenario: Prompt surfaces that instruct skill usage
- **GIVEN** prompt surfaces that instruct skill usage: normal message, spontaneous post, channel lurk, self-research, conversation summary, memory maintenance (workspace and channel), scheduled reminder, and the missing-reply retry prompt
- **WHEN** any of them is rendered for a session
- **THEN** it SHALL supply the literal active Skill API session id and the absolute session staging directory (`{session workspace}/tmp/{literalSkillSessionId}`)

#### Scenario: Skill instruction files direct to the same literal paths
- **GIVEN** skill instruction files (`skills/*/SKILL.md`) and skill script error/example text that give payload-staging instructions for structured file tools and payload-file flags
- **WHEN** the agent follows those instructions to stage a payload
- **THEN** the instructions SHALL direct the agent to the literal session staging directory and session id, never to `$TMPDIR`/`$SESSION_ID` shell tokens
- **AND** the payload-staging instructions covered by this requirement SHALL never name shell tokens as the target of a structured file tool or payload-file flag

#### Scenario: Same contract in pooled and per-spawn for every agent type
- **GIVEN** per-spawn and shared-process (pooled) operation and any agent type
- **WHEN** a payload is staged and a skill is invoked
- **THEN** the contract SHALL hold identically in per-spawn and shared-process (pooled) operation and for every agent type
- **AND** a skill consumer SHALL NEVER depend on a frozen process-level `SESSION_ID` environment variable

#### Scenario: Only the identity/path form changes, not staging semantics
- **GIVEN** the session staging directory, its provisioning, and all containment/authorization semantics
- **WHEN** prompts and skill instructions change the identity/path FORM they use
- **THEN** the staging directory itself, its provisioning, and all containment/authorization semantics SHALL be unchanged
- **AND** this requirement SHALL change only the identity/path FORM of the instructions the agent receives

#### Scenario: Isolated HOME does not change the script root
- **GIVEN** an OMP child with an isolated HOME and a validated deployment-owned skills root
- **WHEN** any skill-instructing prompt or retry is rendered and its recipe is followed
- **THEN** the script SHALL execute at the rendered absolute root, not under child HOME
- **AND** its existing staged payload and active-session authentication SHALL remain unchanged

#### Scenario: Every secondary prompt supplies the root
- **WHEN** normal, spontaneous, lurk, research, summary, workspace/channel maintenance, reminder, and retry instructions are rendered
- **THEN** each SHALL name its trusted absolute script root consistently with its session-id/staging instructions
- **AND** static skill instructions SHALL direct the agent to that rendered root without a child-HOME fallback


### Requirement: Combined Mocked Skill-Handoff Regression Suite

The repository SHALL provide a combined deterministic integration suite that drives the real `SessionOrchestrator` delivery path, the real Skill API server, session registry, and reply/file/reaction handlers, with a mock ACP agent composed through the shared OMP mock-session builder consumed unchanged and its mock-agent fixture extended additively, and a mock platform adapter, in both per-spawn and pooled spawn shapes, with no real platform service.

#### Scenario: Pooled handoff delivers exactly one intended response
- **GIVEN** a pooled OMP session with no frozen subprocess session identity, a shared-process marker, and a valid active-session pointer
- **WHEN** the mock agent stages a payload at the absolute staging path and invokes the reply skill with the literal session id
- **THEN** real authentication and containment SHALL accept the call and exactly one intended platform response SHALL be recorded
- **AND** no retry prompt and no fallback or duplicate delivery SHALL occur

#### Scenario: Retry fires once with literal-first instructions in both shapes
- **GIVEN** a session in either spawn shape whose agent turn ends without any reply, reaction, or file send
- **WHEN** the orchestrator completes its retry handling
- **THEN** exactly one retry prompt SHALL be recorded, carrying the literal session id and absolute staging directory with no unexpanded shell token
- **AND** if the retried turn also produces no response the session SHALL report failure with zero platform deliveries

#### Scenario: File-only turn is a response but not a summary trigger
- **GIVEN** a session whose only delivered output is a successful multi-file send
- **WHEN** the turn completes
- **THEN** the at-least-one-response gate SHALL be satisfied without retry
- **AND** the conversation-summary generation SHALL NOT run
- **AND** a second send-file call SHALL be rejected and a file message id SHALL be rejected by edit-reply

#### Scenario: OpenCode delivery flow remains byte-identical
- **GIVEN** an OpenCode message session driven through the same harness
- **WHEN** the harness exercises process ownership, the resolved skill command, and a legacy token-path payload invocation
- **THEN** OpenCode launch/mode and authentication semantics SHALL remain compatible, while skill recipe paths SHALL resolve to its existing trusted installed root
- **AND** the legacy token-path payload resolution SHALL still deliver the response
- **AND** no readiness verification or trusted-extension involvement SHALL appear

#### Scenario: Handoff prompt carries literal identifiers
- **GIVEN** the happy-path handoff prompt
- **WHEN** the prompt is inspected
- **THEN** it SHALL supply the literal Skill API session id and the absolute staging directory

#### Scenario: Reaction-only turn satisfies the response gate
- **GIVEN** a session whose only delivered output is a reaction
- **WHEN** the turn completes
- **THEN** the at-least-one-response gate SHALL be satisfied without retry
- **AND** the conversation-summary gate SHALL trigger only on a sent text reply

#### Scenario: Combined suite does not restate single-component coverage
- **GIVEN** the scope of the combined suite
- **WHEN** it is reviewed against the predecessor unit suites and the payload-contract delivery test
- **THEN** it SHALL NOT restate single-component decisions already covered there
