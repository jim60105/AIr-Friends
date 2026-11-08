# Bun migration Go/No-Go

Outcome: Go

Date: 2026-11-08T07:59:16.641Z
Freeze SHA: 734c8b03c60a021a3982a07d18c3c3f75962c472
Head: 3f4037493227b0ab0b2ce8272dba4372cd00f73c

## Pins

- Bun version: 1.4.2
- Bun revision prefix: 744846f84
- Base image digest: sha256:4f6e31d1a54d6a3dd312daef655fc998101b5043d52e12592ac293ef04b9bc73
- opencode version: 1.18.21
- omp version: 18.6.1

## Blockers

None.

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
| ACP-01-OC | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-01-OMP | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-02-OC | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-02-OMP | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-03-OC | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-03-OMP | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-04-OC | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-04-OMP | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-05-OC | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-05-OMP | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-06-OC | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-06-OMP | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-07-OC | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-07-OMP | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-08-OC | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-08-OMP | P0-2 | x86_64 | pass | 1 test(s) passed |
| ACP-09-OC | P0-1 | x86_64 | pass | 1 test(s) passed |
| ACP-09-OMP | P0-1 | x86_64 | pass | 1 test(s) passed |
| ACP-10-OC | P0-3 | x86_64 | pass | 1 test(s) passed |
| ACP-10-OMP | P0-3 | x86_64 | pass | 1 test(s) passed |
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

Plan design section 8 steps 3 to 8 using these findings. No P0 blocker is closed by this record.
