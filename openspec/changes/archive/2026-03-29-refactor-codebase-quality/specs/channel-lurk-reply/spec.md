## MODIFIED Requirements

### Requirement: ChannelLurkScheduler extends BaseScheduler
The `ChannelLurkScheduler` SHALL extend `BaseScheduler`, inheriting common lifecycle management while preserving its unique constructor signature (adapter, channels, callback) and channel-checking logic.

#### Scenario: Scheduler extends BaseScheduler
- **WHEN** `ChannelLurkScheduler` is instantiated with adapter, channels, and callback
- **THEN** it SHALL be an instance of `BaseScheduler` and call `setCallback()` from the constructor

#### Scenario: Channel check logic preserved
- **WHEN** the scheduler executes
- **THEN** it SHALL iterate configured channels, check conditions (not self, not mentioned, not reacted, not processed), and invoke the callback for matching channels
