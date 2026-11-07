# identity-groups Specification

## Purpose
Lets an operator declare which platform accounts belong to the same person, validates that declaration at startup, and resolves the linked account workspaces for memory recall without touching the filesystem.

## Requirements

### Requirement: Identity Group Account Normalization

The configuration loader SHALL normalize every `identities[i].accounts[j]` entry to the workspace key form `{platform}/{userId}`, where email accounts become `email/e_<sha256 hex>` of the canonical address. Omitted `identities` SHALL load as an empty list.

#### Scenario: Workspace key kept as-is
- **WHEN** an account entry is `discord/123456789012345678`
- **THEN** the loaded group SHALL contain `discord/123456789012345678`

#### Scenario: Channel-style account id collapsed
- **WHEN** an account entry is `misskey/account/abcdef1234567890`
- **THEN** the loaded group SHALL contain `misskey/abcdef1234567890`

#### Scenario: Email address forms hashed
- **WHEN** account entries are ` Alice@Example.COM `, `email/Alice@example.com` and `email/account/Alice@example.com` in three separate configurations
- **THEN** each loaded group SHALL contain `email/` followed by the same user id that `normalizeEmailMailbox("Alice@example.com").userId` returns

#### Scenario: Email owner id kept as-is
- **WHEN** an account entry is `email/e_` followed by 64 lowercase hex characters
- **THEN** the loaded group SHALL contain that exact value

#### Scenario: Identities omitted
- **WHEN** the configuration has no `identities` key, or an empty `identities:` key (YAML null), and no `IDENTITIES` variable
- **THEN** the loaded configuration SHALL have `identities` equal to `[]`

### Requirement: Identity Group Validation

The configuration loader SHALL reject an invalid `identities` value with a `ConfigError` whose message names the offending field path and does not contain the raw account value.

#### Scenario: Shape errors rejected
- **WHEN** `identities` is not an array, a group is not a mapping, `id` is missing, empty or not a string, or `accounts` is missing, empty or contains a non-string
- **THEN** loading SHALL fail with `ConfigError` naming the field path, for example `identities[0].accounts`

#### Scenario: Duplicate group id rejected
- **WHEN** two groups have the same `id`
- **THEN** loading SHALL fail with `ConfigError` naming `identities[1].id`

#### Scenario: Unsupported account forms rejected
- **WHEN** an account entry has an unknown platform (`slack/123` or `slack/account/123`), has no `/` and no `@` (`discord`), is a `{platform}/channel/...` or `{platform}/timeline/...` id, has a non-email user id that is empty or contains `/`, `\`, `@`, `..`, a leading `.` or surrounding whitespace, or is an unparseable email address
- **THEN** loading SHALL fail with `ConfigError` naming `identities[i].accounts[j]`

#### Scenario: Duplicate account rejected
- **WHEN** two entries in the same group or in different groups normalize to the same workspace key, for example `alice@example.com` and `email/alice@example.com`
- **THEN** loading SHALL fail with `ConfigError` naming the later entry's field path

#### Scenario: Error never echoes the account value
- **WHEN** loading fails because of the entry `not-an-address@@example.com`
- **THEN** the error message and its context SHALL NOT contain `not-an-address`

### Requirement: Identity Groups Environment Override

The loader SHALL accept an `IDENTITIES` environment variable holding a JSON array that replaces `identities` and passes the same normalization and validation. A value that is not valid JSON or not an array SHALL be ignored.

#### Scenario: JSON override applied
- **WHEN** `IDENTITIES` is `[{"id":"alice","accounts":["discord/123","alice@example.com"]}]`
- **THEN** the loaded configuration SHALL contain one group `alice` with `discord/123` and the hashed `email/e_...` key

#### Scenario: Invalid override ignored
- **WHEN** `IDENTITIES` is `{"id":"alice"}` or `not json`
- **THEN** the loaded `identities` SHALL equal the YAML value, or `[]` when YAML has none

#### Scenario: Invalid group in override rejected
- **WHEN** `IDENTITIES` is a JSON array whose group lists the same account twice
- **THEN** loading SHALL fail with `ConfigError`

### Requirement: Linked Workspace Lookup

The identity registry SHALL return, for a workspace in a configured group, the other accounts of that group as workspace descriptors in configuration order, carrying the caller's `isDm`; it SHALL return an empty list for an unlinked workspace and SHALL NOT create or write any file or directory.

#### Scenario: Linked workspaces in configuration order
- **GIVEN** group `alice` with accounts `discord/1`, `misskey/2`, `email/e_<hex>`
- **WHEN** linked workspaces are requested for the `misskey/2` workspace with `isDm: true`
- **THEN** the result SHALL be the `discord/1` and `email/e_<hex>` workspaces in that order, each with `isDm: true` and a path under the configured workspaces root

#### Scenario: Unlinked account
- **WHEN** linked workspaces are requested for a workspace whose key is in no group, or whose group has only that account
- **THEN** the result SHALL be empty

#### Scenario: Group label lookup
- **WHEN** the group of `discord/1` is requested
- **THEN** the result SHALL be `alice`, and the group of an unlinked key SHALL be undefined

#### Scenario: Lookup does not touch the filesystem
- **GIVEN** a linked account whose workspace directory does not exist
- **WHEN** linked workspaces are requested
- **THEN** that workspace descriptor SHALL be returned and its directory SHALL still not exist
