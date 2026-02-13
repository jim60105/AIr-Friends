Feature: Prometheus Metrics Export
  As an operator deploying AIr-Friends on Kubernetes
  I want to scrape Prometheus metrics from the bot
  So that I can monitor health, performance, and usage

  Background:
    Given the bot is running with health check server enabled

  Scenario: Metrics endpoint returns Prometheus format when enabled
    Given the configuration has metrics.enabled set to true
    When I send a GET request to the metrics path
    Then I receive HTTP 200
    And the Content-Type header contains "text/plain"
    And the response body contains "airfriends_sessions_total"

  Scenario: Metrics endpoint returns 404 when disabled
    Given the configuration has metrics.enabled set to false (default)
    When I send a GET request to "/metrics"
    Then I receive HTTP 404

  Scenario: Custom metrics path is respected
    Given the configuration has metrics.path set to "/custom-metrics"
    And the configuration has metrics.enabled set to true
    When I send a GET request to "/custom-metrics"
    Then I receive HTTP 200
    When I send a GET request to "/metrics"
    Then I receive HTTP 404

  Scenario: Session counter increments on message processing
    Given the configuration has metrics.enabled set to true
    When a message is processed successfully
    Then airfriends_sessions_total with labels platform="discord", type="message", status="success" is incremented

  Scenario: Session duration is recorded in histogram
    Given the configuration has metrics.enabled set to true
    When a message session completes in 5 seconds
    Then airfriends_session_duration_seconds records the observation in appropriate buckets

  Scenario: Active sessions gauge reflects concurrent sessions
    Given the configuration has metrics.enabled set to true
    When 2 sessions are actively running
    Then airfriends_active_sessions shows 2
    When both sessions complete
    Then airfriends_active_sessions shows 0

  Scenario: Health endpoint still works with metrics enabled
    Given the configuration has metrics.enabled set to true
    When I send a GET request to "/health"
    Then I receive HTTP 200 with JSON health status

  Scenario: Environment variables override config
    Given METRICS_ENABLED is set to "true"
    And METRICS_PATH is set to "/prom"
    When the configuration is loaded
    Then metrics.enabled is true
    And metrics.path is "/prom"

  Scenario: Metrics failure does not crash the bot
    Given the configuration has metrics.enabled set to true
    When the metrics registry encounters an internal error
    Then the /metrics endpoint returns HTTP 500
    And the bot continues to process messages normally
