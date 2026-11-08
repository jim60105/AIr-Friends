# Spec Delta

## Purpose

Keeps platform names, filesystem error classes and filesystem helper behavior identical to what the application relied on under Deno, so code moved to `node:*` APIs keeps the same decisions on every supported architecture.

## ADDED Requirements

### Requirement: Architecture Name Normalization

`runtimeArch()` SHALL return `x86_64` for an x86-64 machine and `aarch64` for an arm64 machine, whichever spelling the runtime reports, and SHALL return any other machine name unchanged.

#### Scenario: arm64 spelling
- **GIVEN** the runtime reports the machine as `arm64`
- **WHEN** `runtimeArch()` is called
- **THEN** it SHALL return `aarch64`

#### Scenario: x64 spelling
- **GIVEN** the runtime reports the machine as `x64` or `amd64`
- **WHEN** `runtimeArch()` is called
- **THEN** it SHALL return `x86_64`

#### Scenario: Unknown machine
- **GIVEN** the runtime reports the machine as `riscv64`
- **WHEN** `runtimeArch()` is called
- **THEN** it SHALL return `riscv64`

### Requirement: Operating System Name Normalization

`runtimeOs()` SHALL return `windows` for the `win32` platform and the platform name unchanged otherwise.

#### Scenario: Windows platform
- **GIVEN** the platform `win32`
- **WHEN** `runtimeOs()` is called
- **THEN** it SHALL return `windows`

#### Scenario: Linux platform
- **GIVEN** the platform `linux`
- **WHEN** `runtimeOs()` is called
- **THEN** it SHALL return `linux`

### Requirement: Filesystem Error Classification

The classifiers SHALL map `ENOENT` to not-found, `EEXIST` to already-exists, and both `EACCES` and `EPERM` to permission-denied, and SHALL return false for any other value, including non-objects.

#### Scenario: Missing file
- **WHEN** reading a path that does not exist throws
- **THEN** the not-found classifier SHALL return true and the other two SHALL return false

#### Scenario: Unrelated error
- **GIVEN** an `Error` with no `code` and the string `"ENOENT"`
- **WHEN** each classifier is called
- **THEN** every classifier SHALL return false

### Requirement: Path Removal Semantics

`removePath` SHALL remove a file, a symbolic link without following it, or an empty directory, and SHALL reject a non-empty directory and a missing path.

#### Scenario: Empty directory
- **GIVEN** an empty directory
- **WHEN** `removePath` is called on it
- **THEN** the directory SHALL no longer exist

#### Scenario: Symbolic link
- **GIVEN** a symbolic link to a file
- **WHEN** `removePath` is called on the link
- **THEN** the link SHALL be gone and the target file SHALL remain

#### Scenario: Non-empty directory
- **GIVEN** a directory containing a file
- **WHEN** `removePath` is called on it
- **THEN** it SHALL reject and the file SHALL remain

#### Scenario: Missing path
- **WHEN** `removePath` is called on a missing path
- **THEN** it SHALL reject with an error the not-found classifier accepts

### Requirement: Temporary Path Creation

`makeTempDir` and `makeTempFile` SHALL create a new uniquely named entry whose name starts with the given prefix and ends with the given suffix, inside the given directory or the system temporary directory, readable and writable only by the owner.

#### Scenario: Prefix honored
- **WHEN** `makeTempDir({ prefix: "abc-" })` is called twice
- **THEN** two different existing directories SHALL be returned whose names start with `abc-`, each with mode `0700`

#### Scenario: Suffix honored
- **WHEN** `makeTempFile({ suffix: ".json" })` is called
- **THEN** an empty file whose name ends with `.json` SHALL exist at the returned path

### Requirement: Path Existence

`pathExists` SHALL resolve true for an existing path, following symbolic links, false for a missing path or a dangling link, and SHALL reject any other error.

#### Scenario: Dangling link
- **GIVEN** a symbolic link to a missing target
- **WHEN** `pathExists` is called on it
- **THEN** it SHALL resolve false

#### Scenario: Permission error propagates
- **GIVEN** a path under a directory the caller cannot search
- **WHEN** `pathExists` is called on it
- **THEN** it SHALL reject
