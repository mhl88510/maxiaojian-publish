# Maintainer workflow

- Group substantive code, fixes and reusable method changes by topic after affected offline tests. Reuse an open same-topic PR; do not create a PR for every small edit, status check or bookkeeping change.
- Review the exact current head; fix and retest findings in that same PR. Merge only after completed review, resolved discussions and successful configured checks. A push, running review or old-head result is not approval.
- No scheduled scanning, synchronization or review reminders. Completion of a real task is the trigger; no background watcher is installed.
- Keep private account configuration, credentials, session state, business cases, original corpus, media, receipts and local paths outside this public repository. Use fictional fixtures only. Preserve MIT notices and original remotes.
- The public portable core and private business adapters are different layers. Never replace private adapters with excluded-case stubs or empty public account templates. Register exact shared-file mappings locally; reconcile customized files explicitly.
- After a reviewed merge, an explicitly authorized local adoption may use `scripts/reviewed_core_update.py`: frozen Git objects, exact plan SHA, source/runtime drift checks, backups and readback. Otherwise do not install or replace runtime files.
- Tests, CI, version synchronization and adoption must never execute a real upload, draft, publish, account mutation or business retry. Preserve existing locks and receipts.
