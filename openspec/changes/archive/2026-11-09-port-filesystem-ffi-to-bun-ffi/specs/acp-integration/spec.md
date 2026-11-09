# Spec Delta

## MODIFIED Requirements

### Requirement: Explicit Secure ACP Filesystem Platform Policy

The initially supported secure backend SHALL require Linux little-endian x86_64/aarch64, GNU glibc at an explicitly owned supported system location, Linux constrained-open and descriptor-metadata support, exact usable identities and a working runtime foreign-function interface to that libc.

#### Scenario: Supported local filesystem uses the actual backend
- **GIVEN** the supported system library, native ABI and constrained-open/metadata capability are actually available
- **WHEN** protected access operates on a local temporary regular file
- **THEN** actual content IO SHALL use the supported backend and yield consumer-visible content/results
- **AND** a mock result alone SHALL NOT establish native capability

#### Scenario: Unsupported or sandbox-denied mechanism fails closed
- **WHEN** the OS/architecture/libc location is unsupported, FFI permission is denied, or the required constrained syscall/metadata is missing or seccomp-denied
- **THEN** access SHALL return the specific platform/capability failure without protected content IO
- **AND** the same denial SHALL apply for OpenCode/OMP and restricted/YOLO callers without an unsafe fallback

#### Scenario: Unsupported platform and missing capability fail closed
- **WHEN** the OS/ABI/libc is unsupported, a required library/symbol/permission is missing, a required syscall is unavailable under seccomp or an identity is unrepresentable
- **THEN** access SHALL fail closed with a bounded supported-platform/capability reason
- **AND** platform/version identification alone SHALL NOT establish syscall availability or prove the filesystem supplies required metadata

#### Scenario: No dynamic module loading or weaker portable fallback
- **WHEN** the supported backend is requested but unavailable, or an agent/workspace-selected native module is offered
- **THEN** the adapter SHALL NOT load agent/workspace-selected native modules, introduce a compiled/downloaded dependency or fall back to weaker portable access
- **AND** these platform requirements SHALL remain identical regardless of agent type or authorization mode

## ADDED Requirements

### Requirement: Real Backend Reports Kernel Errno

The real Linux backend SHALL report the errno the kernel set for each failed constrained call, including across many alternating successes and failures with event-loop turns between them.

#### Scenario: Symlink and escape errnos
- **GIVEN** a confinement root containing a symbolic link and a directory escape path
- **WHEN** the real backend opens each with resolve flags that forbid links and escapes
- **THEN** it SHALL report `ELOOP` for the link and `EXDEV` for the escape

#### Scenario: Alternating failures
- **GIVEN** a confinement root with one existing and one missing file
- **WHEN** the real backend opens them alternately 10,000 times, yielding to the event loop every 100 calls
- **THEN** every missing-file result SHALL report `ENOENT` and every existing-file result SHALL return a descriptor
