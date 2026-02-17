Feature: Dry Run / Debug Mode
  As a developer or CI pipeline
  I want to run the bot in dry-run mode
  So that I can verify prompt assembly and context without consuming API credits

  Background:
    Given the bot is configured with agent.dryRun settings

  # --- Activation ---

  Scenario: Dry run disabled by default
    Given no dry-run configuration is set
    When a message is received
    Then the ACP Agent is called normally

  Scenario: Activate dry run via config
    Given agent.dryRun.enabled is true in config.yaml
    When the bot starts
    Then a WARN log "Dry run mode ENABLED" is emitted
    And the Agent will not be called for any session

  Scenario: Activate dry run via CLI flag
    Given the bot is started with --dry-run flag
    When the bot loads configuration
    Then agent.dryRun.enabled is overridden to true
    And a WARN log "Dry run mode ENABLED" is emitted

  Scenario: Activate dry run via environment variable
    Given DRY_RUN_ENABLED=true is set in the environment
    When the bot loads configuration
    Then agent.dryRun.enabled is true

  # --- Prompt Output ---

  Scenario: Prompt written to output directory
    Given dry run mode is enabled
    When a message session is processed
    Then the assembled prompt is written to agent.dryRun.outputPath
    And the output filename starts with "message_" and includes a timestamp
    And the file extension is ".md"
    And the ACP Agent connector is never created

  Scenario: Output directory auto-created
    Given dry run mode is enabled
    And agent.dryRun.outputPath does not exist
    When a session is processed
    Then the output directory is created recursively
    And the prompt file is written successfully

  Scenario: Output filename includes session type
    Given dry run mode is enabled
    When a spontaneous post session is processed
    Then the output filename starts with "spontaneous_"
    When a self-research session is processed
    Then the output filename starts with "self_research_"
    When a memory maintenance session is processed
    Then the output filename starts with "memory_maintenance_"
    When a reminder session is processed
    Then the output filename starts with "reminder_"

  # --- Mock Reply ---

  Scenario: Mock reply sent when configured
    Given dry run mode is enabled
    And agent.dryRun.mockReply is "（Dry run 模式 — 此為測試回覆）"
    When a message session is processed
    Then the platform adapter sends the mock reply text
    And the session result has replySent = true

  Scenario: No reply when mockReply is empty
    Given dry run mode is enabled
    And agent.dryRun.mockReply is ""
    When a message session is processed
    Then no reply is sent to the platform
    And the session result has replySent = false

  Scenario: Mock reply failure is non-fatal
    Given dry run mode is enabled
    And the platform adapter throws an error on sendReply
    When a message session is processed
    Then the session still succeeds
    And the error is logged at WARN level

  # --- Session Cleanup ---

  Scenario: Shell session cleaned up after dry run
    Given dry run mode is enabled
    And skill API is enabled
    When a session is processed in dry run mode
    Then the shell session is removed from SessionRegistry
    And the SESSION_ID file is removed from the workspace

  # --- Metrics ---

  Scenario: Metrics recorded for dry run sessions
    Given dry run mode is enabled
    When a session is processed
    Then sessionsTotal counter is incremented with status "success"
    And sessionDurationSeconds histogram is observed
    And activeSessionsGauge is properly incremented and decremented

  # --- Coexistence ---

  Scenario: --dry-run and --yolo can coexist
    Given the bot is started with both --dry-run and --yolo flags
    When a session is processed
    Then dry run mode takes precedence (Agent is not called)
    And no errors occur from the --yolo flag
