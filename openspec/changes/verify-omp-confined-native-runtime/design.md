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
