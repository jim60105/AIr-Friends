# Spec Delta

## Purpose

Defines what the Bun agent spawn boundary must prove with deterministic child processes: flow control, stream integrity, environment isolation and signal handling, before real agents are attempted.

## ADDED Requirements

### Requirement: Stdout Backpressure

When the consumer stops reading a child's stdout, the boundary SHALL stop accepting data so the child blocks, without unbounded buffering in the parent.

#### Scenario: Stalled consumer
- **GIVEN** a child writing to stdout faster than the consumer reads
- **WHEN** the consumer stalls for 1 second
- **THEN** the child's reported progress SHALL stop advancing and parent RSS SHALL grow by under 32 MiB

#### Scenario: Resumed consumer
- **GIVEN** a stalled consumer
- **WHEN** it resumes
- **THEN** every byte the child wrote SHALL arrive

### Requirement: Stdin Backpressure

A write to a child that is not reading SHALL stay pending until the child reads.

#### Scenario: Child not reading
- **GIVEN** a child that sleeps before reading stdin
- **WHEN** 16 MiB is written
- **THEN** the write SHALL be pending after 500 ms and SHALL complete after the child starts reading

### Requirement: Stream Integrity

The boundary SHALL deliver stdin and stdout bytes unchanged at a size well above the pipe capacity, and SHALL not stall while stderr is drained alongside stdout.

#### Scenario: Large round trip
- **GIVEN** a `cat` child
- **WHEN** 64 MiB is written and read concurrently
- **THEN** the SHA-256 of the output SHALL equal the SHA-256 of the input

#### Scenario: Concurrent stderr
- **GIVEN** a child writing 8 MiB to stderr while writing to stdout
- **WHEN** both streams are read
- **THEN** the child SHALL exit and both byte counts SHALL match what it wrote

### Requirement: Stdin End Of File

Closing the boundary's stdin SHALL deliver end of file to the child, and the child's exit SHALL end stdout and resolve `exited`.

#### Scenario: Cat child
- **GIVEN** a `cat` child
- **WHEN** stdin is closed
- **THEN** stdout SHALL reach done and `exited` SHALL report code 0

### Requirement: Explicit Child Environment

The boundary SHALL give the child only the passed variables, established by reading the child's real environment.

#### Scenario: Parent secret absent
- **GIVEN** a sentinel variable in the parent environment that is not in the passed variables
- **WHEN** the child's `/proc/<pid>/environ` is read
- **THEN** it SHALL hold exactly the passed variables

### Requirement: Signal Teardown

Teardown SHALL send SIGTERM through `dumb-init`, and SHALL send SIGKILL after 2 seconds only when the wrapper has not exited.

#### Scenario: Cooperative child
- **GIVEN** a child that exits on SIGTERM
- **WHEN** teardown runs
- **THEN** `exited` SHALL resolve within 2 seconds and neither the wrapper nor the child SHALL remain alive

#### Scenario: Child ignoring SIGTERM
- **GIVEN** a child that ignores SIGTERM
- **WHEN** teardown runs
- **THEN** SIGKILL SHALL be sent no earlier than 2000 ms and the wrapper's exit SHALL be observed by 2500 ms with signal `SIGKILL`

### Requirement: Repeated Spawn Leaves No Residue

Repeated spawn and teardown SHALL not accumulate open descriptors or processes.

#### Scenario: Twenty cycles
- **GIVEN** the parent's open descriptor count
- **WHEN** 20 spawn and teardown cycles finish
- **THEN** the count SHALL be within 2 of the start and no spawned process SHALL remain alive
