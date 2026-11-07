# Spec Delta

## Purpose

Defines what the `bun:ffi` filesystem backend must prove against a real Linux kernel, through the unmodified production confinement logic, before the Bun migration may proceed.

## ADDED Requirements

### Requirement: Kernel Errno Reaches Confinement Logic

The backend SHALL return the kernel's `errno` from a failed `openat2`, and the production access logic SHALL map it to the same failure reason as under the current backend.

#### Scenario: Symlink component
- **GIVEN** a path through a symbolic link beneath the selected root
- **WHEN** it is read through the backend
- **THEN** `openat2` SHALL report `ELOOP` and the access result SHALL have reason `unsafe_traversal`

#### Scenario: Directory escape
- **GIVEN** a relative path that climbs out of the selected root
- **WHEN** it is read through the backend
- **THEN** `openat2` SHALL report `EXDEV` and the access result SHALL have reason `outside_roots`

#### Scenario: Missing read target
- **GIVEN** a relative path that does not exist
- **WHEN** it is read through the backend
- **THEN** `openat2` SHALL report `ENOENT` and the access result SHALL have reason `path_changed`

#### Scenario: Missing parent on create
- **GIVEN** a new-file write whose parent directory does not exist
- **WHEN** it runs through the backend
- **THEN** the access result SHALL have reason `parent_missing`

### Requirement: Errno Stability Under Load

The backend SHALL report the correct `errno` for every call across 10,000 alternating failures with event-loop yields and garbage collection between batches.

#### Scenario: Alternating failures
- **GIVEN** a repeating sequence of symlink, escape and missing-path calls
- **WHEN** 10,000 calls run with a yield every 256 calls and a collection every 1,024 calls
- **THEN** every call SHALL return its expected `errno`

### Requirement: Descriptor Identity Agreement

The backend's `statx` SHALL return a type, inode and device that agree with `node:fs` for the same object.

#### Scenario: File and directory
- **GIVEN** an open descriptor for a regular file and one for a directory
- **WHEN** `statx` runs on each
- **THEN** type, inode, device major and device minor SHALL equal the values derived from a bigint `lstat`

### Requirement: Secure Access Round Trip

Read, exclusive create and overwrite through the backend SHALL produce the same file contents and failure results as the production access contract.

#### Scenario: Multi-chunk read
- **GIVEN** a 200 KiB UTF-8 file with multi-byte characters
- **WHEN** it is read through the backend
- **THEN** the returned text SHALL equal the file content

#### Scenario: Exclusive create collision
- **GIVEN** an existing file
- **WHEN** a new-file write targets it
- **THEN** the result SHALL have reason `path_changed` and the file SHALL be unchanged

#### Scenario: Overwrite truncates
- **GIVEN** an existing file longer than the new content
- **WHEN** it is overwritten through the backend
- **THEN** the file SHALL contain exactly the new content

### Requirement: Backend Fails Closed

The backend SHALL fail with reason `secure_access_unavailable` when libc cannot be used or the kernel rejects `openat2` as unimplemented, and SHALL perform no file access in that case.

#### Scenario: Absent libc
- **GIVEN** a libc path that does not exist
- **WHEN** the backend is created
- **THEN** it SHALL return an error with reason `secure_access_unavailable` and no native calls

#### Scenario: Unloadable libc
- **GIVEN** a libc path that resolves to a file that is not a shared library
- **WHEN** the backend is created
- **THEN** it SHALL return an error with reason `secure_access_unavailable` and no native calls

#### Scenario: Unimplemented system call
- **GIVEN** a seccomp profile returning `ENOSYS` for `openat2`
- **WHEN** a file is read through the backend
- **THEN** the result SHALL have reason `secure_access_unavailable`

### Requirement: Descriptor Cleanup

Mixed successful and failing operations through the backend SHALL leave the process's open descriptor count unchanged.

#### Scenario: Mixed operations
- **GIVEN** 1,000 operations mixing reads, writes and denied paths, after a warm-up
- **WHEN** they finish
- **THEN** the entry count of `/proc/self/fd` SHALL equal the count before them
