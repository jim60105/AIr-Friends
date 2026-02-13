Feature: Memory maintenance (agent-driven summarization and compaction)
  As the AIr-Friends ACP client
  I want to periodically compact large memory logs via agent skills
  So that context quality remains stable as memory grows

  Scenario: Apply default memoryMaintenance config values
    Given config.yaml does not define memoryMaintenance
    When the configuration is loaded
    Then memoryMaintenance.enabled is false
    And memoryMaintenance.model is "gpt-5-mini"
    And memoryMaintenance.minMemoryCount is 50
    And memoryMaintenance.intervalMs is 604800000

  Scenario: Scheduler does not start when disabled
    Given memoryMaintenance.enabled is false
    When the application starts
    Then memory maintenance scheduler is not started

  Scenario: Skip workspace below memory threshold
    Given memoryMaintenance.enabled is true
    And a workspace has enabled memory count lower than minMemoryCount
    When memory maintenance callback runs
    Then that workspace is skipped
    And no maintenance agent session is executed for it

  Scenario: Trigger maintenance for workspace above threshold
    Given memoryMaintenance.enabled is true
    And a workspace has enabled memory count greater than or equal to minMemoryCount
    When memory maintenance callback runs
    Then processMemoryMaintenance is executed for that workspace
    And the configured memoryMaintenance.model is used

  Scenario: Preserve append-only guarantee during compaction
    Given the agent summarizes a group of memories
    When maintenance completes
    Then summary memory entries are appended via memory-save
    And source memories are disabled via memory-patch
    And original memory events remain in memory jsonl logs

  Scenario: Isolate workspace-level failures
    Given memory maintenance fails for one workspace
    When the callback continues processing other workspaces
    Then remaining workspaces are still processed
    And the application remains healthy

  Scenario: Override memoryMaintenance by environment variables
    Given MEMORY_MAINTENANCE_ENABLED is "true"
    And MEMORY_MAINTENANCE_MODEL is "gpt-5-mini"
    And MEMORY_MAINTENANCE_MIN_MEMORY_COUNT is "80"
    And MEMORY_MAINTENANCE_INTERVAL_MS is "7200000"
    When the configuration is loaded
    Then memoryMaintenance.enabled is true
    And memoryMaintenance.model is "gpt-5-mini"
    And memoryMaintenance.minMemoryCount is 80
    And memoryMaintenance.intervalMs is 7200000
