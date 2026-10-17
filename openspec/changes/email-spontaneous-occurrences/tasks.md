# Tasks

Total **6.75 engineering hours**, strictly below 8 hours; an estimate, not a guarantee. Dependencies: email-durable-files, email-submission-journal.

## 1. Complete owned prerequisite

- [ ] 1.1 (2h) Implement durable occurrence snapshot and restore without timestamp reidentification; verify selected/started/terminal snapshots across restart.
- [ ] 1.2 (1.5h) Add typed scheduler/bootstrap occurrence handoff and atomic successor persistence; verify pre-selection persistence failures and existing platform schedule behavior.
- [ ] 1.3 (1.25h) Add/run deterministic regression and native-dispatch or durable scheduler cases. Verify: Use actual SpontaneousScheduler, temporary durable store and counting callback; restart after submitted/unknown evidence but before next-save, assert same owner/thread and zero reselection. Email target slice adds real SMTP DATA-count integration.
- [ ] 1.4 (0.5h) Document authoritative email occurrence file versus unchanged generic schedule file, integrity failure and restart review semantics. Verify docs match owned inputs/results and add scoped CHANGELOG entry.
- [ ] 1.5 (0.75h contingency) Fix bounded owned integration defects and recheck the same acceptance cases, or record unused contingency without adding features.

## 2. Controlled smoke

- [ ] 2.1 (0.75h) Exercise the completed boundary with real predecessor implementations and isolated scripted local services/native executable or scheduler. Verify zero unauthorized effects and unchanged non-email behavior, recording native versus mock evidence explicitly.

No application verification runs during this planning assignment; only final artifact gates run after the entire proposal batch is complete.
