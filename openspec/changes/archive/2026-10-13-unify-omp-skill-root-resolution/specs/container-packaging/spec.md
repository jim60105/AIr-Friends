# Spec Delta

## ADDED Requirements

### Requirement: Owned Skill Image Excludes External Publication

The OMP owned image skill root SHALL contain only deployment-cataloged bundled skill directories and shared skill libraries, installed content-faithfully with the existing root-owned modes. External additions published into a development source tree SHALL NOT become owned image skills. The same deployment-controlled bundled catalog SHALL govern OMP script eligibility and external-name collision protection; installed-tree discovery SHALL NOT amend it.

#### Scenario: Development external addition is absent from owned staging
- **GIVEN** a packaging source fixture contains all bundled skills and an extra externally installed directory
- **WHEN** the owned skill image source is assembled
- **THEN** the extra directory SHALL be excluded from `/opt/air/skills` installation
- **AND** cataloged skills and shared libraries SHALL retain their exact authored content
- **AND** the external addition SHALL NOT become a native OMP owned discovery source

#### Scenario: Linked source cannot enter the owned skill image
- **WHEN** a bundled staging entry is linked or resolves outside the declared bundled source
- **THEN** owned packaging SHALL fail before installation
- **AND** it SHALL NOT substitute a foreign copy for cataloged content

#### Scenario: OpenCode personal root and existing owned manifest remain unchanged
- **WHEN** bundled-only OMP skill staging is introduced
- **THEN** the OpenCode personal skills root SHALL remain `/home/deno/.agents/skills`
- **AND** OMP skill installation SHALL remain root-owned at `/opt/air/skills`
- **AND** the existing settings/extension/prompt manifest scope and agent versions SHALL remain unchanged
