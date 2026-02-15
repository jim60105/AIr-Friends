Feature: Git Backup for Agent Notes and Knowledge Base

  Background:
    Given the bot is configured with gitBackup.enabled = true
    And gitBackup.remoteUrl is set to a valid GitHub repository URL
    And GITHUB_TOKEN is available in the environment

  Scenario: First-time initialization
    When the bot starts up
    Then a Git repository is initialized in the data directory
    And a .gitignore file is created excluding SESSION_ID files
    And the remote origin is set to the configured URL
    And the repository is synced with the remote (fetch + pull)

  Scenario: Periodic backup with changes
    Given there are uncommitted changes in the data directory
    When the backup scheduler triggers
    Then all changes are staged with git add -A
    And a commit is created with message "backup: {ISO timestamp}"
    And the commit is pushed to the remote repository

  Scenario: Periodic backup without changes
    Given there are no uncommitted changes in the data directory
    When the backup scheduler triggers
    Then no commit is created
    And no push is attempted
    And a log message indicates no changes to backup

  Scenario: Push conflict resolution
    Given there are local commits not yet pushed
    And the remote has diverged
    When the backup scheduler triggers and push fails
    Then a git pull --rebase is attempted
    And the push is retried once

  Scenario: Graceful shutdown backup
    Given the bot is running with git backup enabled
    When the bot receives a shutdown signal
    Then a final backup is performed before shutdown
    And the scheduler is stopped

  Scenario: Missing GITHUB_TOKEN
    Given GITHUB_TOKEN is not set
    When the backup scheduler attempts to push
    Then the push fails with an authentication error
    And the error is logged without exposing credentials

  Scenario: Configuration via environment variables
    Given GIT_BACKUP_ENABLED is set to "true"
    And GIT_BACKUP_REMOTE_URL is set to a repository URL
    When the bot loads configuration
    Then git backup is enabled with the specified remote URL
