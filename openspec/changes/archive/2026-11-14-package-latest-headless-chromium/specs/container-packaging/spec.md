# Spec Delta

## ADDED Requirements

### Requirement: Latest Headless Browser Resolved And Verified At Build

The container image SHALL install the latest `@sparticuz/chromium` release pack for the target architecture, resolved at build time, verified against the digest that release publishes for the asset before any install step consumes it, and installed at the contracted PATH name `/usr/local/bin/chromium`. Browser version pinning is explicitly NOT performed.

#### Scenario: Latest release resolved per build
- **GIVEN** a container build for `amd64` or `arm64`
- **WHEN** the browser unpack stage runs
- **THEN** it SHALL resolve the newest non-prerelease release at build time and select that release's pack asset for the architecture
- **AND** a newer published browser SHALL be picked up by the next build that re-executes the stage (the image pipeline varies the build identity on every run) without any repository change
- **AND** the resolved version SHALL be printed in the build log

#### Scenario: Published digest verified before install
- **GIVEN** a resolved release whose asset metadata carries a digest
- **WHEN** the downloaded pack is checked
- **THEN** the build SHALL verify it against that published digest before unpacking or installing anything
- **AND** a digest mismatch, a missing digest, or a failed download SHALL abort the build without installing a browser

#### Scenario: Unsupported architecture fails fast
- **GIVEN** a target architecture outside `amd64`/`arm64`
- **WHEN** the architecture selection runs
- **THEN** the build SHALL fail naming the unsupported architecture

#### Scenario: Ambiguous or missing asset fails closed
- **GIVEN** a release whose asset set yields zero or multiple matches for the selected architecture's pack name
- **WHEN** the asset selection runs
- **THEN** the build SHALL fail naming the match count rather than choosing arbitrarily

#### Scenario: No Playwright download remains
- **WHEN** the finished container build definition and image are inspected
- **THEN** no Playwright package install, browser download, or Playwright-resolved OS dependency step SHALL remain
- **AND** the image SHALL NOT contain a Playwright browser cache
- **AND** the browser SHALL be present only as the installed executable

#### Scenario: Package notice installed
- **WHEN** the finished image is inspected
- **THEN** the browser package's license text SHALL be installed under the image's third-party license location at `/licenses/chromium/LICENSE`
- **AND** the license text SHALL be verified against a content digest before install, so a changed license aborts the build instead of shipping silently
- **AND** the project's existing license file SHALL remain unchanged

### Requirement: Build-Time Browser Launch Verification

The image build SHALL fail unless the installed browser both reports a version consistent with the resolved release and completes a real headless startup over the DevTools protocol, so a build that ships a browser unable to launch on the image's own OS dependency set cannot succeed.

#### Scenario: Resolved version reported
- **GIVEN** the browser has been installed in the image
- **WHEN** the build probe runs the executable's version query
- **THEN** the reported major version SHALL match the resolved release's major version
- **AND** the full reported version SHALL be recorded in the build log and a non-matching major SHALL abort the build

#### Scenario: Real startup verified
- **GIVEN** the installed browser and the image's OS dependency set
- **WHEN** the build probe launches the browser headless with an ephemeral debugging port and a temporary profile
- **THEN** it SHALL require the browser's debugging-port file and a reachable DevTools endpoint within a bounded timeout
- **AND** the probe SHALL tear the browser down and leave no profile or daemon state in the image
- **AND** a launch or endpoint failure SHALL abort the build

### Requirement: Explicit Browser OS Dependency Set

The image SHALL install the headless browser's OS libraries and the text-rendering fonts as an explicit package list rather than a tool-resolved set, and SHALL NOT depend on a browser-testing framework to resolve them.

#### Scenario: Only the binary's own requirements are installed
- **WHEN** the image's browser runtime packages are inspected
- **THEN** they SHALL cover the browser binary's dynamic library requirements and font rendering
- **AND** no package SHALL be installed solely to satisfy a browser-testing framework

#### Scenario: Screenshot text rendering preserved
- **GIVEN** a build of the image
- **WHEN** the browser renders a page containing non-Latin text
- **THEN** glyphs SHALL be produced by the same font coverage the image provided before this change
- **AND** no font family previously supplied by the removed framework step SHALL be silently dropped
