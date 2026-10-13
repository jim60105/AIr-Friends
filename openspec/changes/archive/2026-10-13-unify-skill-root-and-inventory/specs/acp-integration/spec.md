# Spec Delta

## REMOVED Requirements

### Requirement: Skill Auto-Approve List Construction

**Reason**: Replaced by `Skill Auto-Approve List Construction Over the Single Resolved Root`. This requirement asserted the OMP-only catalog asymmetry — "OMP SHALL admit only deployment-cataloged bundled names", "configured OMP names SHALL NOT expand eligibility beyond the deployment-controlled bundled catalog" and the scenario `Shared development root does not grant external OMP execution` — which made a runtime-installed external skill available to OpenCode and unusable for OMP from the same directory. The reverse `agentType` selector is removed with it.
**Migration**: No operator action. Both agent types now enumerate the same observed root under the retained `scripts/*.ts`, `RESERVED_SKILL_ENTRIES`, interpreter-allowlist and identity-recheck rules.

## MODIFIED Requirements

### Requirement: Root-Exact Script Entrypoint Approval

Restricted script approval SHALL require the invocation entrypoint to match an enumerated canonical absolute file inside the single deployment-resolved root of the selected agent. Relative paths SHALL use registered session cwd. Failed observations or changed root identity SHALL deny. Suffix, HOME and daemon-cwd fallback SHALL NOT grant approval. Existing shell/argument policies and native-YOLO posture SHALL remain unchanged.

#### Scenario: Literal trusted recipe is approved

- **GIVEN** an observed script under the resolved root and an otherwise valid restricted invocation
- **WHEN** the script is invoked directly or as the entrypoint after `deno run`
- **THEN** it SHALL be approved by exact canonical script membership
- **AND** quoting the absolute script path or adding a tolerated fd redirect SHALL preserve the result

#### Scenario: Planted workspace copy is rejected

- **GIVEN** the trusted script is `<resolved root>/send-reply/scripts/send-reply.ts`
- **AND** a session workspace contains a different file at `skills/send-reply/scripts/send-reply.ts`
- **WHEN** either the planted absolute path or that session-relative path is invoked
- **THEN** the permission gate SHALL deny execution even though the trailing path components match

#### Scenario: Ambient and other-agent copies are rejected

- **GIVEN** the selected agent's resolved root is the shared configured skill root
- **WHEN** an invocation names a same-suffix copy in a daemon-HOME directory, a separately installed skill tree, or a sibling-prefix directory
- **THEN** the script whitelist SHALL NOT approve it
- **AND** an agent of either type SHALL likewise reject a copy under a root it did not resolve

#### Scenario: Relative path names the actual trusted script

- **GIVEN** the requesting session cwd and a relative entrypoint resolve to the exact enumerated script in the selected root
- **WHEN** the registered session's permission request is evaluated
- **THEN** relative spelling SHALL preserve script approval
- **AND** a different session cwd producing a planted copy SHALL be denied

#### Scenario: Symlink escape and replaced root are denied

- **GIVEN** an inventory accepted a root and its contained script
- **WHEN** the script resolves outside that root through a link, canonical observation fails, the script is missing, or the accepted root is replaced at the same pathname
- **THEN** execution SHALL be denied without suffix matching or automatic acceptance of the replacement root

#### Scenario: Whitelisted path used as an argument grants nothing

- **WHEN** an arbitrary executable receives an approved script path as a trailing argument
- **THEN** the request SHALL NOT gain script approval
- **AND** chained requests SHALL still require every segment to independently pass the existing gate

#### Scenario: Constructor cannot discover its own root

- **WHEN** a client or connector is prepared without the mandatory selected-agent root/inventory input
- **THEN** preparation SHALL fail explicitly
- **AND** it SHALL NOT scan the process cwd or HOME to repair the missing input

## ADDED Requirements

### Requirement: Skill Auto-Approve List Construction Over the Single Resolved Root

Script inventory SHALL use the single explicit resolved root and canonical absolute contained files for BOTH agent types. Neither agent type SHALL restrict eligibility to an authored name catalog. Configured names SHALL filter eligible entries without expanding them. HOME scanning or missing-skill command grants SHALL NOT occur. Observed command skills with instruction files and no scripts directory MAY retain exact prefixes.

#### Scenario: Configured skills list

- **GIVEN** `autoApproveSkills` is provided in client config
- **WHEN** the skill inventory is constructed for either agent type
- **THEN** it SHALL include only observed configured skills inside the resolved root
- **AND** a script's entry SHALL be its canonical absolute path
- **AND** a configured name SHALL NOT expand eligibility beyond the observed root's contents

#### Scenario: Directory-scanned skills list

- **GIVEN** no `autoApproveSkills` configuration or an empty list
- **WHEN** the skill inventory is constructed with the resolved root
- **THEN** both agent types SHALL scan that directory for installed skills
- **AND** it SHALL NOT supplement the inventory from a HOME-derived tree or a separately installed skill tree

#### Scenario: Shared root grants either agent the installed script

- **GIVEN** both agent types resolve the same root and external publication adds a non-bundled script there
- **WHEN** inventories are constructed with empty approval lists or with that external name explicitly configured
- **THEN** both agent types SHALL admit the contained installed script
- **AND** neither agent type SHALL require a catalog entry for it

#### Scenario: Missing configured external skill yields no executable grant

- **GIVEN** a configured external script skill failed installation or its directory is absent when the connector is constructed
- **WHEN** the auto-approve inventory is built
- **THEN** it SHALL contain neither that skill's script path nor a bare command prefix inferred from its name
- **AND** unrelated installed skills SHALL remain available

#### Scenario: Explicit shared install root includes external scripts

- **GIVEN** a configured external skill is published under the same resolved root as built-ins
- **WHEN** that skill is selected by the configured list or directory scan
- **THEN** its contained scripts SHALL receive canonical absolute inventory entries under that root
- **AND** no second trusted root SHALL be required

#### Scenario: Observed command skill remains available

- **GIVEN** the selected root contains a command-based skill with SKILL.md and no scripts directory
- **WHEN** that skill is selected by the configured list or directory scan
- **THEN** its exact command prefix SHALL remain eligible under the existing argument policy
- **AND** a scripts-directory observation error SHALL NOT be interpreted as a command-based skill

#### Scenario: Traversing name cannot select a foreign directory

- **WHEN** a configured skill name contains a separator, parent traversal or an absolute path
- **THEN** it SHALL contribute no script or command-prefix authority outside the resolved root

#### Scenario: Non-TypeScript script remains non-executable on either agent type

- **GIVEN** the resolved root contains a skill whose scripts directory holds only a non-`.ts` executable (for example a `.py` or shell script)
- **WHEN** the auto-approve inventory is constructed for either agent type and that script is invoked
- **THEN** no inventory entry and no grant SHALL be created for it
- **AND** enumeration SHALL remain limited to `scripts/*.ts` with the `deno` interpreter as the sole allowlisted entrypoint
