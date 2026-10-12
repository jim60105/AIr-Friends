# Spec Delta

## ADDED Requirements

### Requirement: Owned Skill URIs Remain Readable Through Native Read

The registered read replacement SHALL expose the pinned native skill-reading capability. A skill URI SHALL resolve only against the declared canonical deployment-owned skill source and pass current ownership, generation, and read-target checks before same-tool native delegation. Foreign, shadowed, traversing, stale, or unresolvable skills and other unsupported URI schemes SHALL remain denied. Network completion SHALL NOT grant skill authority.

#### Scenario: Declared owned skill is readable
- **WHEN** a current skill URI resolves to an instruction file under the canonical owned source
- **THEN** the read replacement SHALL admit the authorized target and delegate once to native skill reading
- **AND** the native instruction result SHALL be preserved without network dispatch

#### Scenario: Skill name alone cannot authorize a shadow
- **WHEN** a same-name skill comes from a foreign root, a replaced identity, or a stale generation
- **THEN** it SHALL be denied before native delegation
- **AND** name matching or network-adapter completion SHALL NOT override the denial

#### Scenario: Traversal and other devices remain blocked
- **WHEN** a skill URI escapes its owned source or an unsupported device URI is read
- **THEN** it SHALL be denied with a bounded reason
- **AND** no generic URI pass-through or fallback root SHALL be used
