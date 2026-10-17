# Spec Delta

## Purpose

Defines common durable email sending service so email users and operators receive testable privacy, reliability and authorization behavior within the approved platform scope.

## ADDED Requirements

### Requirement: Single durable send path

Every email sending path SHALL persist constructed content and submission intent before SMTP and consult recorded operation state on repeated calls.

#### Scenario: Repeated accepted request
- **WHEN** same logical operation is requested after restart
- **THEN** the recorded result is returned with zero additional SMTP transactions

### Requirement: Sent copy cannot cause resend

After SMTP acceptance, remote sent-folder failure SHALL preserve submitted state and local sent history and SHALL NOT trigger another SMTP submission.

#### Scenario: APPEND fails
- **WHEN** SMTP accepts but IMAP APPEND rejects
- **THEN** result reports submitted with sent-copy failure and signed local history exists

### Requirement: Crash outcomes require review

A crash between submission and durable outcome SHALL become unknown, and missing evidence SHALL block automatic submission.

#### Scenario: Accept then persist fails
- **WHEN** SMTP accepted but recording the final outcome fails
- **THEN** caller sees unknown with operation ID and automatic replay is suppressed

