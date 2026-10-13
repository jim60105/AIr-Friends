# Spec Delta

## REMOVED Requirements

### Requirement: Owned Skill Image Excludes External Publication

**Reason**: The requirement existed to keep a second, separately packaged OMP skill root (`/opt/air/skills`) free of external additions, backed by the deployment-controlled bundled catalog as both the packaging filter and the OMP script-eligibility gate. After `unify-skill-root-and-inventory` and `align-omp-skill-trust-to-shared-root` both agent types resolve one configured root, the runtime installs into that root and OMP admits it, so a catalog-filtered owned tree has no remaining function; its scenarios `Development external addition is absent from owned staging`, `Linked source cannot enter the owned skill image` and `OpenCode personal root and existing owned manifest remain unchanged` describe a packaging step that no longer exists.
**Migration**: No operator action. The image ships one skill tree at `/home/deno/.agents/skills`. An operator who mounted or referenced `/opt/air/skills` MUST point that reference at the configured `AGENT_SKILLS_DIR` root instead; external skill installs land in the same tree as the authored content.

## ADDED Requirements

### Requirement: Single Packaged Skill Tree For Every Agent Type

The container image SHALL install exactly one skill tree — the authored repository `skills/` content — at the personal skill root that every agent type resolves, and SHALL NOT install a second skill tree under any other path. No owned skill root, staged catalog filter or bundled-catalog packaging rule SHALL remain. The owned OMP artifact tree, its digest manifest scope and the pinned agent versions SHALL remain unchanged.

#### Scenario: One skill tree in the finished image

- **WHEN** the finished image layout is asserted from the Containerfile install instructions
- **THEN** exactly one skill tree SHALL exist, at the personal skill root that the configured value resolves
- **AND** `/opt/air/skills` SHALL be absent
- **AND** no Containerfile instruction, manifest entry, packaged script or code path SHALL name it

#### Scenario: Authored content and runtime installs share the one tree

- **GIVEN** the image ships the authored bundled skills and the deployment configures an external skill
- **WHEN** bootstrap publishes that external skill
- **THEN** the authored content SHALL be installed content-faithfully as the tree's initial content
- **AND** the external skill SHALL land in that same tree, which SHALL remain the only install location for either agent type

#### Scenario: Owned runtime tree and manifest scope are untouched

- **WHEN** the packaging change is completed
- **THEN** the owned OMP artifact tree under its own root and the SHA-256 digest manifest covering exactly the extension tree, settings overlays and prompt artifact SHALL remain unchanged
- **AND** no skill byte SHALL enter that manifest's digest set
- **AND** the generated extension bundle contract and the pinned agent versions SHALL remain unchanged
