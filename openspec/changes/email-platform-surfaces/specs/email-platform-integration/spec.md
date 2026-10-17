# Spec Delta

## Purpose

Defines email platform-aware workspace and administration surfaces so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## ADDED Requirements

### Requirement: Platform-wide email recognition

Existing platform-aware routing, workspace lifecycle, memory maintenance, metrics and administration surfaces SHALL recognize email with the same authorization boundaries as other platforms.

#### Scenario: Workspace lifecycle
- **WHEN** an email workspace contains memory, archive files and orphan tmp copies
- **THEN** recognition includes it, cleanup removes eligible tmp only and maintenance sees its memory

### Requirement: Private correspondence backup

Email state and actual signed sent history including source/attachment files SHALL participate in existing data-directory backups.

#### Scenario: Backup scope
- **WHEN** backup enumerates configured data with email state and workspace archives
- **THEN** all durable email files are included without exposing credentials through backup logs

### Requirement: Existing platform behavior unchanged

Discord and Misskey behavior SHALL remain unchanged and no new dashboard email workflow SHALL be introduced.

#### Scenario: Selector regression
- **WHEN** existing authenticated admin platform selectors are used
- **THEN** email is recognized where platform selection exists and other options remain functional

