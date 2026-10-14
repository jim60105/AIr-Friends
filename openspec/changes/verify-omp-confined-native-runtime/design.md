# Design

## Context

See proposal.md for motivation. Production native assets/data mounts are complete in cutover-omp-native-runtime Task 1.2. This change adds real native evidence, not a deferred implementation fix. Source pin is OMP18.6.1/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60. Existing AgentConnector.connect/createSession/setSessionModel/cancel/reconnectAndResumeSession/disconnect provide the ACP lifecycle; AgentProcessPool.run(options,runner) is the public pool entry point. Never call its private acquireProcess as a substitute for the real lease consumer.

## Goals / Non-Goals

Observe native model discovery, authored settings consumption, selected data persistence/load and confined asset availability for both modes. Do not prompt a paid model, add production logic, translate configuration, certify public search/proxy/platform delivery or infer execution from helper mocks.

## Decisions

### Authored fixture, no configuration synthesis

Create tests/fixtures/omp-native-runtime/home/.omp/agent/models.yml with one provider parity-fixture: baseUrl http://127.0.0.1:43187/v1, auth none, api openai-completions; one model id parity-fixture, reasoning false, input [text], contextWindow8192, maxTokens1024, cost input/output/cacheRead/cacheWrite all zero. The [native models contract](https://github.com/can1357/oh-my-pi/blob/2a2c6dcbbb558c0f8145f67f28b3370984f2bf60/docs/models.md) owns that schema. Test setup copies the tracked authored bytes into temporary HOME before observation. No server or paid prompt is needed for catalog and setSessionModel; F starts the fixed loopback server for actual tool calls. No YAML serializer/string interpolation generates fixtures or production mode config.

### Actual native lifecycle

Use createAgentConfig('omp',workingDir,config,yolo,...) and real AgentConnector, not the mock subprocess. Configure the one existing shared skills root and matching stock native root fixture manually; production authored mode YAML remains untouched. connect() performs the real ACP handshake; createSession([],workingDir) returns the actual ID; setSessionModel(id,'parity-fixture') must resolve the advertised catalog; cancel(id) then reconnectAndResumeSession(id,workingDir,[]) must return true and preserve actual native session identity/model. Capture real connectors through the existing constructor connectorFactory injection (return new AgentConnector(options), not a fake). In finally await connector.disconnect() for each captured instance and pool.stop() to clear timers after pool.isIdle(); there is no pool.dispose/shutdown API. No synthetic session ID or fabricated catalog is allowed.

### Confined selected roots

Run this lifecycle with filesystemConfinement false and true, then use public AgentProcessPool.run with the same poolKey but opposite resolved modes. Each mode must write native state beneath its selected XDG_DATA_HOME/omp and restore its own actual session after restart. Real bwrap IO controls from D prove own-data write, sibling-marker unreadability and skill-root read-only behavior; this change additionally proves native parser/model/data consumers see the selected files and directories. No broad HOME/dataRoot mount is added here. Missing bwrap/native binary, mismatched --version, native config/load error or unavailable trace tool is an explicit failed prerequisite, not a silent skip. Confinement observations require the supported Linux namespace runtime.

### Config writes and evidence

Observe production factory/native spawn after fixture provisioning with strace -f tracing openat/openat2/creat/rename/renameat/renameat2/unlink/unlinkat (or equivalent writable-open/replacement watcher). Classify events for the authored mode/model paths: zero writable opens/replacements required. Native database/session writes are expected only at selected data roots. No source-string, argv-only, byte-equality or copied-default assertion counts as behavior evidence. Init/catalog/load proves those mechanisms, not execution of the capability handler; F owns native scripted tool execution.

## Risks / Trade-offs

Fixed port is shared only with F and not bound here. The supported namespace runtime and exact binary are mandatory acceptance prerequisites. Native source was inspected during planning; real binary checks run only during implementation acceptance. Estimates total3.50h including1.00h acceptance/docs/repair. Adding this independent evidence change keeps the mount-complete runtime cutover at7.75h, with no bridge, compatibility layer or broken intermediate consumer.

## Delivered Implementation Notes

Two facts were established against the pinned binary during implementation and
are recorded here because they amend this document's wording rather than its
scope.

1. **Model selection uses the advertised `provider/modelId` identity.** Task 1.2
   words the catalog check as `setSessionModel(actualId, 'parity-fixture')`, but
   OMP's ACP catalog advertises the concrete `provider/modelId` value
   (`docs/models.md` §"Provider and model identity"): with the authored fixture
   the native `session/new` response advertises exactly one model option whose
   value is `parity-fixture/parity-fixture`. The connector's stable-first
   resolution matches advertised values case-insensitively and only exactly
   (`src/acp/session-config.ts`), so a bare `parity-fixture` is a `catalog-miss`
   by construction. The probe therefore selects the fixture with
   `parity-fixture/parity-fixture` (the provider/id pair the fixture authors) and
   asserts the stronger property the spec scenario names: the fixture model is
   resolved from the ACTUAL advertised catalog — proved by a negative control
   that an unadvertised id is rejected naming the advertised values. No
   fabrication, unstable fallback or catalog substitution is involved.
2. **Confinement acceptance requires a runtime that can materialise the
   production mount list.** `--ro-bind-try` tolerates a missing source, but bwrap
   aborts the spawn when it cannot create a bind DESTINATION, and the shared
   default read-only set includes `/usr/local/bin` — unspawnable wherever
   `/usr/local` is a symlink into `/var` (Fedora Silverblue-style hosts). The
   confined leg reuses the existing gate the real-bwrap IO controls already
   apply, and the acceptance was executed in the deployment-shaped container
   (real `/usr/local`, `bwrap`, `strace`, `dumb-init` and the pinned `18.6.1`
   binary), where all three tests ran with no ignore. Nothing fell back to
   unconfined success.
3. **Review-driven corrections (post-implementation rubber-duck).** Four
   blocking findings were folded in rather than dispositioned away:
   (a) prerequisites are now an explicit ACCEPTANCE mode — `OMP_NATIVE_ACCEPTANCE=1`
   makes every unavailable prerequisite a FAILED test naming the exact reason
   (missing binary, non-zero `--version`, a version other than `18.6.1`, missing
   observer, no namespace privilege, unsupported host topology), while an
   ordinary `deno task test` run leaves the same leg UNEXERCISED instead of
   claiming native success; the version probe additionally requires a successful
   invocation and rejects prerelease spellings.
   (b) The observed interval now covers the production factory AND the native
   start: `tests/mocks/omp-native-lifecycle-driver.ts` performs the shipped
   factory construction and the whole connector lifecycle as a child process the
   probe runs under `strace -f`, which also removes the previous
   second-invocation truncation (the recovery respawn is a descendant of the
   same traced process, one trace per mode).
   (c) Path observation resolves operands against the descriptor directories
   `-y` decodes and fails closed on an unresolved operand that carries a watched
   file's name; only successfully completed opens count as read consumption, and
   a focused unit case pins the classifier's contract.
   (d) The confined leg's own-persistence assertion now requires identifiable
   native artifacts (`agent.db`, `sessions`) in that mode's selected data child,
   with the sibling marker moved out of every measured directory, and teardown
   asserts that no captured connector keeps a process and that every recorded
   native pid exited.

   A second review round tightened three of those remedies: descriptor
   directories are now collected only from the ARGUMENT part of a record (a
   decoded RETURN descriptor names the file that was opened, never a base
   directory), every resolved path is normalized so a `/cfg/./models.yml`
   spelling cannot slip past the comparison, `successfulEventsBeneath()` itself
   requires the recorded success (the unit case no longer filters on the
   caller's side and adds a failed attempt beneath the same directory), and the
   leak evidence records each wrapper plus its live descendants at every acquire
   and recovery respawn and boundedly waits for all of them to disappear —
   because `disconnect()` clears the connector's process reference regardless of
   the kill result.
