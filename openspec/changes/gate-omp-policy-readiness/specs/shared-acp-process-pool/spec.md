# Delta: shared-acp-process-pool

## MODIFIED Requirements

### Requirement: Session Resumption After Process Death

When a shared process dies while a session's prompt is in flight, the system SHALL restart that pool key's process, resume the existing session via the ACP `session/load` method (OpenCode persists session state in its channel-scoped data directory), and apply controlled recovery: re-issue the prompt ONLY if no response (reply, reaction, or file send) has been recorded for the session; if a response was already sent, the session SHALL complete without re-prompting. Side-effectful skill operations (`send-reply`, `memory-save`) are guarded by the in-bot session registry state (`replySent`, `fileSent`, attempt counts), which survives the agent process restart because it lives in the bot process. When the prompt IS re-issued, the recovery/retry prompt SHALL enumerate the session's already-executed skill operations (memory-save calls, reply attempts, file sends), so the resumed agent knows what has already happened and avoids re-doing side effects.

Both crash reconnect and `session/load` recovery SHALL target the session's recorded acquisition context — the ORIGINAL permission mode, process/state namespace, absolute cwd, and operator MCP definitions written at acquisition — and the respawn SHALL occur in the SAME permission mode's process and state namespace; recovery SHALL never spawn or reuse an opposite-mode process and SHALL NOT re-resolve the mode (the recorded values are the recovery target). Verifying the session against that record SHALL happen BEFORE any teardown or load: loading an opposite-mode session, or a session whose recorded mode/namespace does not match the recovery context (including a session with no provenance record where provenance is required), is an OWNERSHIP VIOLATION that fails closed — not a recovery fallback, not a silent cross-mode load, and not reported as the existing "agent does not support session resumption" session loss. After a successful same-mode load, the resumed session's configuration SHALL be restored through the shared model-configuration logic (canonical option-cache restoration, then model and — best-effort, from the session's resolved value — reasoning reapplication), and the recovered session id's OWN per-session filesystem/permission gate context SHALL be re-registered before prompting resumes; another session's fallback context SHALL never be substituted for an unknown or unrecoverable session id. At the named post-restore attach point, a recovered RESTRICTED OMP session SHALL have its policy readiness re-verified against the NEW process instance before resumption: readiness established on the dead instance is not carried over, and a session whose readiness cannot be re-established SHALL fail that session's recovery with the bounded readiness-rejection reason rather than resume unguarded. Native-YOLO OMP and OpenCode resumptions SHALL proceed without any readiness assertion. Every recovery failure (ownership violation, load failure, post-load model catalog miss, gate-context restore failure, readiness re-verification rejection) SHALL remain isolated to the affected session's existing per-session error handling: recovery SHALL NOT cross permission modes, SHALL NOT drop the failed session's gate context to force progress, and SHALL leave other sessions' gate contexts, processes, and the execution lease untouched.

#### Scenario: In-flight session resumed after process restart
- **GIVEN** a shared process dies while a session's prompt is in flight and no response has been sent yet
- **WHEN** the system restarts that pool key's process
- **THEN** it SHALL load the existing session via ACP `session/load` (history is replayed to the client) and re-issue the prompt on the resumed session

#### Scenario: Response already sent — no re-prompt
- **GIVEN** a shared process dies while a session's prompt is in flight and the session has already sent a reply or delivered a file
- **WHEN** the system restarts the process and loads the session
- **THEN** the session SHALL complete WITHOUT re-issuing the prompt, so no duplicate reply or memory event is produced

#### Scenario: Recovery re-enters the recorded mode and state namespace
- **GIVEN** an OMP deployment session whose ownership record (written at acquisition) names permission mode `native-yolo` and that mode's process/state namespace
- **WHEN** its pooled process dies mid-prompt and recovery restarts and loads the session
- **THEN** the respawn SHALL occur in the `native-yolo` mode's process and state namespace with the session's recorded cwd and operator MCP definitions
- **AND** recovery SHALL NOT spawn or reuse a restricted-mode process and SHALL NOT re-resolve the permission mode from current configuration

#### Scenario: Restricted recovery context cannot load a native-YOLO-owned session
- **GIVEN** an OMP deployment where a session's ownership record names mode `native-yolo` but the recovery context is restricted (recorded mode/namespace does not match)
- **WHEN** recovery attempts to load that session
- **THEN** it SHALL fail closed with a distinct ownership-violation error identifying the session and the mismatched mode/namespace
- **AND** it SHALL NOT issue `session/load`, SHALL NOT spawn or disconnect any process, and SHALL NOT treat the mismatch as a fallback to either mode

#### Scenario: Native-YOLO recovery context cannot load a restricted-owned session
- **GIVEN** an OMP deployment where a session's ownership record names mode `restricted` but the recovery context is native-YOLO
- **WHEN** recovery attempts to load that session
- **THEN** it SHALL fail closed with the same ownership-violation behavior in this second direction — no load, no process side effects, no cross-mode resumption

#### Scenario: Ownership violation is distinct from unsupported resumption
- **GIVEN** a recovery attempt that fails because of an ownership violation and another that fails because the agent does not support `session/load`
- **WHEN** each failure surfaces to the affected session's error handling
- **THEN** the two failures SHALL carry distinct, bounded diagnostics so an ownership violation is never reported or logged as capability-absence session loss

#### Scenario: Gate context restored to the correct session before resuming
- **GIVEN** a shared-process pool where one client serves several ACP sessions and one session's process dies mid-prompt
- **WHEN** the session is recovered via `session/load`
- **THEN** the recovered session id's OWN gate context (its cwd, owning skill session id, and per-session permission flags) SHALL be re-registered before any re-issued prompt
- **AND** no other session's gate context SHALL be substituted for it, and other sessions' contexts SHALL remain registered and unmodified

#### Scenario: Recovery failure stays isolated to the affected session
- **GIVEN** two sessions on one pooled process, one of which enters recovery and fails (ownership violation, load failure, post-load catalog miss, gate-context restore failure, or readiness re-verification rejection)
- **WHEN** that recovery fails
- **THEN** only the affected session SHALL end in error through its existing per-session error handling
- **AND** the other session's gate context, agent session, process, and the execution lease SHALL be unaffected, and the failed session's gate context SHALL NOT be dropped to force progress

#### Scenario: Restricted recovery re-verifies readiness on the new process instance
- **GIVEN** a recovered restricted OMP session whose gate context has just been restored on a respawned process
- **WHEN** recovery reaches the named post-restore attach point
- **THEN** readiness established on the dead process instance SHALL NOT be reused and readiness SHALL be re-verified against the new instance
- **AND** WHEN re-verification succeeds the session SHALL resume; WHEN it rejects, that session's recovery SHALL fail with the bounded readiness-rejection reason and no prompt SHALL be re-issued for it

#### Scenario: Native-YOLO and OpenCode resumptions carry no readiness assertion
- **GIVEN** a recovered native-YOLO OMP session and a recovered OpenCode session
- **WHEN** their recoveries complete and prompting resumes
- **THEN** no readiness verification SHALL occur and no readiness denial SHALL be possible for either session
