# Spec Delta

## Purpose

Defines user-directed source-preserving forwarding so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## ADDED Requirements

### Requirement: Accessible designated source

Forwarding SHALL require a grant for the selected original within the initiating user accessible history and SHALL preserve the original body and attachments.

#### Scenario: Another owner source
- **WHEN** a valid recipient grant is paired with another user sourceRecordId
- **THEN** forward is denied with no source content disclosed

### Requirement: Complete forward or explicit failure

Forwarding SHALL reject exceeded limits or missing source attachments without claiming complete submission or silently omitting material.

#### Scenario: One attachment unavailable
- **WHEN** a selected source has a missing archived attachment
- **THEN** no SMTP send occurs and result identifies an incomplete-source safe error

### Requirement: Source does not authorize delivery

Source bodies, source addresses and source attachments SHALL remain reference content and SHALL not grant additional destinations.

#### Scenario: Injected forward instruction
- **WHEN** original message names a second recipient and asks to redirect
- **THEN** only the current user granted destination is usable

