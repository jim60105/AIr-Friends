# Bun migration Go/No-Go

Outcome: No-Go

Date: 2026-11-07T22:30:45.966Z
Freeze SHA: 734c8b03c60a021a3982a07d18c3c3f75962c472
Head: 9bb84e21f8c3aee5123b8ba79db2f2b4d446d00a

## Pins

- Bun version: 1.4.2
- Bun revision prefix: 744846f84
- Base image digest: sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73
- opencode version: 1.18.21
- omp version: 18.6.1

## Blockers

- ACP-01-OC x86_64: fail
- ACP-01-OMP x86_64: fail
- ACP-02-OC x86_64: fail
- ACP-02-OMP x86_64: fail
- ACP-03-OC x86_64: fail
- ACP-03-OMP x86_64: fail
- ACP-04-OC x86_64: fail
- ACP-04-OMP x86_64: fail
- ACP-05-OC x86_64: fail
- ACP-05-OMP x86_64: fail
- ACP-06-OC x86_64: fail
- ACP-06-OMP x86_64: fail
- ACP-07-OC x86_64: fail
- ACP-07-OMP x86_64: fail
- ACP-08-OC x86_64: fail
- ACP-08-OMP x86_64: fail
- ACP-09-OC x86_64: fail
- ACP-09-OMP x86_64: fail
- ACP-10-OC x86_64: fail
- ACP-10-OMP x86_64: fail

## Criteria

| ID | P0 | Arch | Status | Detail |
| --- | --- | --- | --- | --- |
| PROC-01 | P0-2 | x86_64 | pass | 1 test(s) passed |
| PROC-02 | P0-2 | x86_64 | pass | 1 test(s) passed |
| PROC-03 | P0-2 | x86_64 | pass | 1 test(s) passed |
| PROC-04 | P0-2 | x86_64 | pass | 1 test(s) passed |
| PROC-05 | P0-2 | x86_64 | pass | 1 test(s) passed |
| PROC-06 | P0-1 | x86_64 | pass | 1 test(s) passed |
| PROC-07 | P0-3 | x86_64 | pass | 1 test(s) passed |
| PROC-08 | P0-3 | x86_64 | pass | 1 test(s) passed |
| PROC-09 | P0-3 | x86_64 | pass | 1 test(s) passed |
| ACP-01-OC | P0-2 | x86_64 | fail | 1 failed test(s): ACP-02-OMP: 16 MiB of agent output arrives byte-identical by SHA-256 |
| ACP-01-OMP | P0-2 | x86_64 | fail | 1 failed test(s): ACP-02-OMP: 16 MiB of agent output arrives byte-identical by SHA-256 |
| ACP-02-OC | P0-2 | x86_64 | fail | 1 failed test(s): ACP-02-OMP: 16 MiB of agent output arrives byte-identical by SHA-256 |
| ACP-02-OMP | P0-2 | x86_64 | fail | 1 failed test(s): ACP-02-OMP: 16 MiB of agent output arrives byte-identical by SHA-256 |
| ACP-03-OC | P0-2 | x86_64 | fail | 1 failed test(s): ACP-02-OMP: 16 MiB of agent output arrives byte-identical by SHA-256 |
| ACP-03-OMP | P0-2 | x86_64 | fail | 1 failed test(s): ACP-02-OMP: 16 MiB of agent output arrives byte-identical by SHA-256 |
| ACP-04-OC | P0-2 | x86_64 | fail | 2 failed test(s): ACP-04-OMP: a 3 s reader stall keeps 4 MiB of agent text byte-identical by SHA-256, ACP-06-OMP: a 3 s client timeout leaves teardown to resolve with the wrapper exited |
| ACP-04-OMP | P0-2 | x86_64 | fail | 2 failed test(s): ACP-04-OMP: a 3 s reader stall keeps 4 MiB of agent text byte-identical by SHA-256, ACP-06-OMP: a 3 s client timeout leaves teardown to resolve with the wrapper exited |
| ACP-05-OC | P0-2 | x86_64 | fail | 2 failed test(s): ACP-04-OMP: a 3 s reader stall keeps 4 MiB of agent text byte-identical by SHA-256, ACP-06-OMP: a 3 s client timeout leaves teardown to resolve with the wrapper exited |
| ACP-05-OMP | P0-2 | x86_64 | fail | 2 failed test(s): ACP-04-OMP: a 3 s reader stall keeps 4 MiB of agent text byte-identical by SHA-256, ACP-06-OMP: a 3 s client timeout leaves teardown to resolve with the wrapper exited |
| ACP-06-OC | P0-2 | x86_64 | fail | 2 failed test(s): ACP-04-OMP: a 3 s reader stall keeps 4 MiB of agent text byte-identical by SHA-256, ACP-06-OMP: a 3 s client timeout leaves teardown to resolve with the wrapper exited |
| ACP-06-OMP | P0-2 | x86_64 | fail | 2 failed test(s): ACP-04-OMP: a 3 s reader stall keeps 4 MiB of agent text byte-identical by SHA-256, ACP-06-OMP: a 3 s client timeout leaves teardown to resolve with the wrapper exited |
| ACP-07-OC | P0-2 | x86_64 | fail | 2 failed test(s): ACP-04-OMP: a 3 s reader stall keeps 4 MiB of agent text byte-identical by SHA-256, ACP-06-OMP: a 3 s client timeout leaves teardown to resolve with the wrapper exited |
| ACP-07-OMP | P0-2 | x86_64 | fail | 2 failed test(s): ACP-04-OMP: a 3 s reader stall keeps 4 MiB of agent text byte-identical by SHA-256, ACP-06-OMP: a 3 s client timeout leaves teardown to resolve with the wrapper exited |
| ACP-08-OC | P0-2 | x86_64 | fail | 2 failed test(s): ACP-04-OMP: a 3 s reader stall keeps 4 MiB of agent text byte-identical by SHA-256, ACP-06-OMP: a 3 s client timeout leaves teardown to resolve with the wrapper exited |
| ACP-08-OMP | P0-2 | x86_64 | fail | 2 failed test(s): ACP-04-OMP: a 3 s reader stall keeps 4 MiB of agent text byte-identical by SHA-256, ACP-06-OMP: a 3 s client timeout leaves teardown to resolve with the wrapper exited |
| ACP-09-OC | P0-1 | x86_64 | fail | 1 failed test(s): ACP-02-OMP: 16 MiB of agent output arrives byte-identical by SHA-256 |
| ACP-09-OMP | P0-1 | x86_64 | fail | 1 failed test(s): ACP-02-OMP: 16 MiB of agent output arrives byte-identical by SHA-256 |
| ACP-10-OC | P0-3 | x86_64 | fail | 1 failed test(s): ACP-02-OMP: 16 MiB of agent output arrives byte-identical by SHA-256 |
| ACP-10-OMP | P0-3 | x86_64 | fail | 1 failed test(s): ACP-02-OMP: 16 MiB of agent output arrives byte-identical by SHA-256 |
| FFI-01 | P0-4 | x86_64 | pass | 1 test(s) passed |
| FFI-01 | P0-4 | aarch64 | pass | 1 test(s) passed |
| FFI-02 | P0-4 | x86_64 | pass | 1 test(s) passed |
| FFI-02 | P0-4 | aarch64 | pass | 1 test(s) passed |
| FFI-03 | P0-4 | x86_64 | pass | 1 test(s) passed |
| FFI-03 | P0-4 | aarch64 | pass | 1 test(s) passed |
| FFI-04 | P0-4 | x86_64 | pass | 1 test(s) passed |
| FFI-04 | P0-4 | aarch64 | pass | 1 test(s) passed |
| FFI-05 | P0-4 | x86_64 | pass | 1 test(s) passed |
| FFI-05 | P0-4 | aarch64 | pass | 1 test(s) passed |
| FFI-06 | P0-4 | x86_64 | pass | 3 test(s) passed |
| FFI-06 | P0-4 | aarch64 | pass | 3 test(s) passed |
| FFI-07 | P0-4 | x86_64 | pass | 1 test(s) passed |
| FFI-07 | P0-4 | aarch64 | pass | 1 test(s) passed |
| FFI-08 | P0-4 | x86_64 | pass | 1 test(s) passed |
| FFI-08 | P0-4 | aarch64 | pass | 1 test(s) passed |
| FFI-09 | P0-4 | x86_64 | pass | 1 test(s) passed |
| FFI-09 | P0-4 | aarch64 | pass | 1 test(s) passed |
| EGR-01 | P0-5 | x86_64 | pass | 4 test(s) passed |
| EGR-02 | P0-5 | x86_64 | pass | 5 test(s) passed |
| EGR-03 | P0-5 | x86_64 | pass | 1 test(s) passed |
| EGR-04 | P0-5 | x86_64 | pass | 1 test(s) passed |
| EGR-05 | P0-5 | x86_64 | pass | 3 test(s) passed |
| EGR-06 | P0-5 | x86_64 | pass | 3 test(s) passed |
| EGR-07 | P0-5 | x86_64 | pass | 4 test(s) passed |
| EGR-08 | P0-5 | x86_64 | pass | 4 test(s) passed |
| INJ-01 | P0-6 | x86_64 | pass | 2 test(s) passed |
| INJ-02 | P0-6 | x86_64 | pass | 2 test(s) passed |
| INJ-03 | P0-6 | x86_64 | pass | 2 test(s) passed |
| INJ-04 | P0-6 | x86_64 | pass | 2 test(s) passed |
| INJ-05 | P0-6 | x86_64 | pass | 51 test(s) passed |
| INJ-06 | P0-6 | x86_64 | pass | 1 test(s) passed |
| INJ-07 | P0-6 | x86_64 | pass | 2 test(s) passed |
| INJ-08 | P0-6 | x86_64 | pass | 2 test(s) passed |

## Observations

- aarch64/ffi: {}
- aarch64/ffi-enosys: {}
- x86_64/acp: {"spawnBackend":"node"}
- x86_64/acp-failure: {"spawnBackend":"node"}
- x86_64/egress: {}
- x86_64/ffi: {}
- x86_64/ffi-enosys: {}
- x86_64/injection: {"bunOptionsEffective":true,"knownEnvReferenceExempt":true}
- x86_64/injection-noconfig: {"missingConfigExit":[1,1],"missingConfigStderr":["ENOENT: /opt/air/skill-bunfig.toml: No such file or directory (open())","ENOENT: /opt/air/skill-bunfig.toml: No such file or directory (open())"],"missingConfigBehavior":"fail-stop"}
- x86_64/process: {"spawnBackend":"node","sigkillSurvivors":2}

## Open after this decision

| P0 | Scope | Owner |
| --- | --- | --- |
| P0-1 | Production variable set (skill token directory, provider keys); the suites prove only `PATH` and `HOME` as required variables | Step 5 |
| P0-3 | Container stop, pool cleanup, restart, and children that outlive a wrapper SIGKILL | Step 5 and step 8 |
| P0-7 | All of sandbox detection and fail-closed behavior | Steps 5 to 7 |
| P0-8 | All of restart persistence | Step 8 |
| P0-9 | All of native dependencies and external tools | Steps 3 and 7 |
| P0-10 | All of CI, container deployment and the rollback drill | Steps 7 and 8 |

## Next step

Stop the migration. An owner decides whether a blocker is solvable; if not, master unfreezes.
