# Spec Delta

## MODIFIED Requirements

### Requirement: Lifecycle Suite Determinism and Execution Boundaries

The combined lifecycle suite SHALL be deterministic: timer-driven paths SHALL use the repository's fake-time pattern, subprocess interactions SHALL be bounded on explicit recorded RPCs or the connector's crash signal, and no new test SHALL rely on wall-clock sleeps or delay-based kill races. The suite SHALL require no network access, real agent, official `omp` executable, provider or paid credentials, or container/bwrap execution.

#### Scenario: No sleep-dependent new tests
- **WHEN** the new suite's tests are examined for timing behavior
- **THEN** every time-sensitive assertion SHALL be driven by fake-time advancement or an explicit scripted message or crash signal
- **AND** no new test SHALL contain a wall-clock sleep used to await state

#### Scenario: Integration task stays live-acceptance-free
- **GIVEN** the repository's integration test task executes the new suite
- **WHEN** the suite runs
- **THEN** only in-process fixtures and `bun`-launched mock subprocesses SHALL be spawned
- **AND** no `omp --version`, container build, bwrap invocation, or external provider request SHALL occur

#### Scenario: No live external dependencies
- **GIVEN** the repository's integration test task executes the combined suite
- **WHEN** the suite runs
- **THEN** it SHALL require no network access to external hosts, no real agent, and no official `omp` executable
- **AND** no provider or paid credential SHALL be used, and the suite SHALL run under the existing integration task and coverage gates without silently invoking live-agent acceptance

## ADDED Requirements

### Requirement: Integration Suites Leave No Leaked Descriptors Or Processes

Each agent integration test SHALL end with the test process's open file-descriptor count and its descendant-process count back at the values measured before the test started.

#### Scenario: Shared-process suite teardown
- **GIVEN** a shared-process integration test that spawned mock agents
- **WHEN** the test's teardown has completed
- **THEN** the test process SHALL have no descendant process and no more open descriptors than before the test

#### Scenario: Leak is reported
- **GIVEN** a test that leaves one spawned mock agent running
- **WHEN** the leak check runs after teardown
- **THEN** the check SHALL fail and name the surviving PID
