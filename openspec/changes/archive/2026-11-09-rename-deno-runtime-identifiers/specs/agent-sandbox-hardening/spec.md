# Spec Delta

## MODIFIED Requirements

### Requirement: Shared Resolved Skill Tree Has Read-Only Runtime Visibility

Filesystem confinement SHALL expose the single resolved skill tree at that same absolute path as a read-only runtime mount for either agent type. Skill mounting SHALL consume the explicit deployment input rather than rediscover a tree from HOME or session cwd. Legitimate container access under `/home/air/.agents` SHALL remain read-only. A mount SHALL NOT grant script auto-approval, owned provenance or workspace write permission.

#### Scenario: OpenCode container personal installation remains accessible

- **GIVEN** the resolved install root is `/home/air/.agents/skills`
- **WHEN** confinement arguments are constructed
- **THEN** the existing legitimate `/home/air/.agents` read-only visibility SHALL remain available
- **AND** the installed skill tree SHALL appear at its exact resolved path without a writable mount

#### Scenario: The single resolved root is exposed for either agent type

- **GIVEN** the deployment resolved one skill root
- **WHEN** confinement arguments are constructed for an `opencode` session and for an `omp` session
- **THEN** both SHALL expose that same root read-only at its literal path
- **AND** no separately packaged skill tree SHALL be mounted or privileged for either agent type

#### Scenario: Development and custom install roots are exposed literally

- **GIVEN** the selected root is the repository development tree or an explicitly configured custom directory
- **WHEN** confinement arguments are constructed
- **THEN** that exact resolved directory SHALL be exposed read-only
- **AND** writable workspace/runtime grants SHALL remain unchanged and SHALL NOT override the skill tree's read-only visibility

#### Scenario: Equal or enclosing skill root cannot replace mandatory writable grants

- **GIVEN** the canonical skill root equals or contains a mandatory writable workspace, TMPDIR, shared workspace or runtime mount
- **WHEN** confinement is prepared
- **THEN** preparation SHALL fail before spawn instead of making skills writable or silently making mandatory runtime state read-only

#### Scenario: Child skill tree is mounted after a writable parent

- **GIVEN** the skill tree is a child of a writable mounted parent and contains no mandatory writable descendants
- **WHEN** confinement arguments are constructed
- **THEN** its read-only bind SHALL occur after that parent bind
- **AND** the parent outside the skill tree SHALL retain its existing writable grant

## ADDED Requirements

### Requirement: Confinement Exposes The Bun Skill Runtime Read-Only

The default filesystem confinement SHALL bind the trusted skill config `/opt/air/skill-bunfig.toml` read-only and SHALL bind no Deno cache, Deno manifest or Deno lock path.

#### Scenario: Default read-only paths
- **WHEN** the default confinement read-only path list is read
- **THEN** it SHALL contain `/opt/air/skill-bunfig.toml` and SHALL contain no path with the segment `deno` or `deno-dir`

#### Scenario: Default writable runtime paths
- **WHEN** the default confinement writable runtime path list is read
- **THEN** every entry SHALL be under `/home/air`
