# Spec Delta

## MODIFIED Requirements

### Requirement: Filesystem-Touching Bash Tools Route Through the ACP Gate

The agent permission map (`agent-config/opencode.json`) SHALL NOT set any filesystem-touching bash tool or skill-script invocation pattern to `allow` in the restricted profile. Entries exposed for these operations SHALL use `ask` so execution reaches the ACP client's root-exact and session-scoped policy. Valid skill scripts under explicitly configured custom roots SHALL reach this gate without requiring a `skills` suffix in the root name. Unrelated execution SHALL remain default-denied, and the native-YOLO profile SHALL remain unchanged.

#### Scenario: A read-capable bash tool is not self-authorized at the agent layer
- **GIVEN** the restricted-profile permission map
- **WHEN** the agent requests an arbitrary-file-read primitive such as `head -c 2000 /proc/1/environ`, `rg -a "" /proc/1/environ`, `jq -Rs . /proc/1/environ` or `pandoc /proc/1/environ -t plain`
- **THEN** the corresponding bash entry SHALL be `ask`, forwarding the request to the ACP client

#### Scenario: No filesystem-touching entry remains self-authorizing
- **GIVEN** the restricted-profile permission map
- **WHEN** its bash allow-list is inspected
- **THEN** no entry capable of reading or writing arbitrary file content, including search/read utilities, document/media/archive tools, agent-browser or skill-script globs, SHALL be `allow`

#### Scenario: Media/archive tools never self-authorized
- **GIVEN** the restricted-profile permission map
- **WHEN** a file-reading/writing media or archive tool is configured, including ffmpeg, magick, convert, identify, mogrify, unzip, zip or 7zz
- **THEN** it SHALL use `ask`

#### Scenario: Entrypoint-matched skill patterns may remain allow
- **GIVEN** either a legitimate installed script or a same-suffix planted workspace copy
- **WHEN** the restricted agent evaluates a direct script invocation or `deno run` invocation
- **THEN** the previous skill-pattern allow exception SHALL no longer apply and it SHALL forward the execution permission request to ACP
- **AND** ACP SHALL approve the legitimate enumerated entrypoint and reject the planted copy

#### Scenario: Custom root does not require a skills-named directory
- **GIVEN** an explicitly configured OpenCode root `/srv/agent-tooling`
- **WHEN** its enumerated TypeScript script is invoked directly or through `deno run`
- **THEN** the restricted permission map SHALL forward the request to ACP
- **AND** a foreign TypeScript entrypoint SHALL gain no grant from that routing pattern

## ADDED Requirements

### Requirement: Resolved Skill Tree Has Read-Only Runtime Visibility

Filesystem confinement SHALL expose the selected agent's resolved skill tree at that same absolute path as a read-only runtime mount. Skill mounting SHALL consume the explicit deployment input rather than rediscover a tree from HOME or session cwd. Legitimate OpenCode container access under `/home/deno/.agents` SHALL remain read-only. A mount SHALL NOT grant script auto-approval, OMP owned provenance or workspace write permission.

#### Scenario: OpenCode container personal installation remains accessible
- **GIVEN** OpenCode's resolved install root is `/home/deno/.agents/skills`
- **WHEN** its confinement arguments are constructed
- **THEN** the existing legitimate `/home/deno/.agents` read-only visibility SHALL remain available
- **AND** the installed skill tree SHALL appear at its exact resolved path without a writable mount

#### Scenario: OMP owned root is exposed without trusting personal skills
- **GIVEN** OMP's resolved root is `/opt/air/skills`
- **WHEN** its confinement arguments are constructed
- **THEN** that tree SHALL be mounted read-only
- **AND** personal-tree presence SHALL NOT add an OMP script grant

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
