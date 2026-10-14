# Spec Delta

## ADDED Requirements

### Requirement: Shared Deployment Skills Root In ACP Callbacks

The skills-root helper SHALL consume the existing shared deployment skill-root observation and SHALL NOT trust a directory by name, by workspace contents or as an arbitrary model-supplied location. An agent-writable skill tree SHALL NOT by itself disqualify an otherwise canonical root. Canonical identity, link-free components, containment and current-generation evidence SHALL remain mandatory.

#### Scenario: Owned skill instruction is readable as an observation

- **GIVEN** a deployment-declared read-only root and a matching canonical root observation for the requesting session
- **WHEN** the instruction target is observed within that root
- **THEN** the result SHALL include the trusted read-only role and canonical owned instruction identity
- **AND** no mutation authority SHALL be created

#### Scenario: Skill name collision or external link is not trusted

- **WHEN** a workspace file outside the declared root, a link leaving the root, mismatching root identity, or a root overlapping a writable root is supplied as a trusted target
- **THEN** the helper SHALL return the specific ownership/containment/overlap failure
- **AND** it SHALL NOT substitute a same-name file or globally disable skills to claim success

#### Scenario: Skills root is disjoint, read-only and non-escaping

- **WHEN** the canonical skills root is established
- **THEN** it SHALL be disjoint from writable workspace/shared roots and SHALL be granted only the read-only role
- **AND** a skills-root link leaving that root SHALL fail trusted membership even if its destination lies within another readable root

#### Scenario: Trust decisions certify no native support or policy change

- **WHEN** the helper reaches trusted read-only identity decisions
- **THEN** those decisions SHALL NOT certify native OMP selection/discovery support, change unrelated workspace read-extension policy, or introduce a skills write exception

#### Scenario: Agent-writable shared root is admitted under identity checks

- **GIVEN** the deployment-declared shared skill root is writable by the runtime agent user
- **WHEN** an owned skill instruction inside it is observed
- **THEN** ownership SHALL be decided by canonical identity, link-free components, realpath containment and current-generation evidence alone
- **AND** a linked component, an escaping target, a replaced identity or a stale generation SHALL still deny

## REMOVED Requirements

### Requirement: Trusted Read-Only ACP Skills Root Identity

**Reason**: Its critical-skill predecessor and generation scenarios are removed from the daemon callback contract.

**Migration**: Use Shared Deployment Skills Root In ACP Callbacks for the retained canonical callback root behavior. No runtime shim or data migration is required.

### Requirement: Owned-Only OMP Settings Discovery Sources

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use the shared configured root, script inventory and protected ACP callbacks; native exploration and settings loading remain upstream-owned. No record migration is required.

### Requirement: OMP Owned Skill Read And Execution Over The Shared Root

**Reason**: Superseded by the approved native-OMP parity design; its additional governance mechanism is removed.

**Migration**: Use the shared configured root, script inventory and protected ACP callbacks; native exploration and settings loading remain upstream-owned. No record migration is required.
