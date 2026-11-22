# Historical tracking migration cutover

Historical tracking starts at the successful commit of
`1795219200000-CreateHistoricalTracking`. Rows written by that migration use
`baseline` markers and describe the database snapshot at cutover; they are not
evidence of earlier user actions. In particular, analytics must not infer when
a pre-cutover task was created, completed, rescheduled, or deleted.

## Required deployment sequence

Do not run this migration while an older application instance can write to the
database. The migration takes table locks during its snapshot, but those locks
are released when its transaction commits; an old instance could otherwise
write an untracked change between migration completion and deployment.

1. Schedule a write-maintenance window. Disable task/routine write endpoints,
   pause background workers that can write these tables, stop all old backend
   instances, and wait for in-flight transactions to finish.
2. Confirm the application is still in maintenance and that no old process can
   restart or accept writes.
3. Build and deploy the release containing this migration and transactional
   event/version tracking. Keep writes disabled during migration and rollout.
4. Run `npm run migration:up`. Each migration uses TypeORM's default individual
   transaction; the migration classes also declare `transaction = true`. The first
   migration locks
   `users`, `tasks`, `routines`, and `routine_weekdays` in
   `SHARE ROW EXCLUSIVE` mode, then creates timezone/routine baselines and task
   baseline events in the same transaction. The lock waits for earlier table
   writers and prevents new writes while the snapshot is read.
5. Start only the new backend release. Confirm every instance is running the
   event-tracking release and that migration status reports no pending
   migrations.
6. Resume writes and background workers.

If migration or deployment fails, keep writes disabled until either the new
release is healthy or the deployment is explicitly rolled back. Do not restart
an old writer after the migration has committed: it cannot record task events
or routine versions. If rollback is required after tracked writes have begun,
the migration's `down()` intentionally refuses to remove post-cutover history.

## Baseline and pre-cutover interpretation

- `task_activity_events.event_type = 'baseline'` captures the task's state at
  cutover and must not be counted as a task creation/completion event.
- `routine_versions.change_type = 'baseline'` captures the routine and its
  weekday configuration at cutover. The cutover local date is a partial
  baseline day; a future daily report must mark it incomplete or exclude it
  from full-day scheduled-productivity totals rather than assuming the observed
  configuration applied for the entire day.
- `user_time_zone_versions.version_no = 1` captures the timezone configured at
  cutover. Later timezone changes have their own effective instants.
- Pre-cutover daily task history cannot be reconstructed reliably from the
  current task row. Treat historical event analytics before cutover as
  unavailable or explicitly incomplete; never fabricate events.
- The existing task listing endpoint remains available for pre-cutover dates
  and returns task rows that already exist. Routine-generated rows are not
  backfilled or newly generated for dates earlier than the first routine
  baseline, because the routine configuration for those dates is unknown.
- A pre-cutover routine task has only an ambiguous baseline snapshot. Future
  task reconciliation preserves such rows because the system cannot establish
  whether a user had manually changed them.

The migration is additive. It does not delete or rewrite existing task,
routine, weekday, or timezone data. The separate soft-delete migration adds
`routines.deleted_at`; its `down()` also refuses to drop data if any routine
has been soft-deleted.
