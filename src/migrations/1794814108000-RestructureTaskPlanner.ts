import type { MigrationInterface, QueryRunner } from "typeorm";

export class RestructureTaskPlanner1794814108000 implements MigrationInterface {
  name = "RestructureTaskPlanner1794814108000";

  // UP MIGRATION
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Stop before modifying data when legacy values cannot be mapped safely.
    await queryRunner.query(`DO $migration$
    BEGIN
      IF to_regclass('public.users') IS NULL
        OR to_regclass('public.tasks') IS NULL
        OR to_regclass('public.habits') IS NULL
        OR to_regclass('public.habit_logs') IS NULL THEN
        RAISE EXCEPTION 'Expected legacy task planner tables were not found; inspect the applied schema before migrating';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.tasks
        WHERE status IS NOT NULL
          AND BTRIM(status) <> ''
          AND UPPER(BTRIM(status)) NOT IN ('PENDING', 'COMPLETED')
      ) THEN
        RAISE EXCEPTION 'Tasks contain statuses other than PENDING or COMPLETED; map these values before migrating';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.habits
        WHERE frequency IS NOT NULL
          AND BTRIM(frequency) <> ''
          AND UPPER(BTRIM(frequency)) <> 'DAILY'
      ) THEN
        RAISE EXCEPTION 'Habits contain non-daily frequency values; assign weekdays before migrating';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.users
        GROUP BY LOWER(BTRIM(email))
        HAVING COUNT(*) > 1
      ) THEN
        RAISE EXCEPTION 'Users contain email addresses that collide case-insensitively; resolve duplicates before migrating';
      END IF;
    END;
    $migration$`);

    await queryRunner.query(`ALTER TABLE "users"
      ADD COLUMN "time_zone" VARCHAR(64) NOT NULL DEFAULT 'UTC'`);
    await queryRunner.query(`UPDATE "users"
      SET "email" = LOWER(BTRIM("email")),
          "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
          "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP)`);
    await queryRunner.query(`ALTER TABLE "users"
      ALTER COLUMN "created_at" SET NOT NULL,
      ALTER COLUMN "updated_at" SET NOT NULL,
      ADD CONSTRAINT "ck_users_time_zone_not_blank" CHECK (BTRIM("time_zone") <> '')`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "UQ_users_email"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_email_lower" ON "users" (LOWER("email"))`);

    await queryRunner.query(`ALTER TABLE "tasks"
      ADD COLUMN "task_date" DATE,
      ADD COLUMN "scheduled_time" TIME WITHOUT TIME ZONE,
      ADD COLUMN "completed_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`UPDATE "tasks" AS task
      SET "task_date" = COALESCE(
            (task."due_date" AT TIME ZONE account."time_zone")::DATE,
            (task."created_at" AT TIME ZONE account."time_zone")::DATE,
            (CURRENT_TIMESTAMP AT TIME ZONE account."time_zone")::DATE
          ),
          "scheduled_time" = CASE
            WHEN task."due_date" IS NULL THEN NULL
            ELSE (task."due_date" AT TIME ZONE account."time_zone")::TIME
          END,
          "status" = CASE
            WHEN UPPER(BTRIM(COALESCE(task."status", ''))) = 'COMPLETED' THEN 'completed'
            ELSE 'pending'
          END,
          "completed_at" = CASE
            WHEN UPPER(BTRIM(COALESCE(task."status", ''))) = 'COMPLETED'
              THEN COALESCE(task."updated_at", task."created_at", CURRENT_TIMESTAMP)
            ELSE NULL
          END,
          "created_at" = COALESCE(task."created_at", CURRENT_TIMESTAMP),
          "updated_at" = COALESCE(task."updated_at", CURRENT_TIMESTAMP)
      FROM "users" AS account
      WHERE account."id" = task."user_id"`);
    await queryRunner.query(`ALTER TABLE "tasks"
      ALTER COLUMN "task_date" SET NOT NULL,
      ALTER COLUMN "status" TYPE VARCHAR(16) USING "status"::VARCHAR(16),
      ALTER COLUMN "status" SET DEFAULT 'pending',
      ALTER COLUMN "status" SET NOT NULL,
      ALTER COLUMN "created_at" SET NOT NULL,
      ALTER COLUMN "updated_at" SET NOT NULL,
      ADD CONSTRAINT "ck_tasks_status" CHECK ("status" IN ('pending', 'completed')),
      ADD CONSTRAINT "ck_tasks_completion_time" CHECK (
        ("status" = 'completed' AND "completed_at" IS NOT NULL)
        OR ("status" = 'pending' AND "completed_at" IS NULL)
      )`);

    await queryRunner.query(`CREATE TABLE "routines" (
      "id" SERIAL NOT NULL,
      "user_id" INTEGER NOT NULL,
      "title" VARCHAR(255) NOT NULL,
      "description" TEXT,
      "scheduled_time" TIME WITHOUT TIME ZONE,
      "starts_on" DATE NOT NULL,
      "ends_on" DATE,
      "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PK_routines_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_routines_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "ck_routines_date_range" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on")
    )`);
    await queryRunner.query(`CREATE TABLE "routine_weekdays" (
      "routine_id" INTEGER NOT NULL,
      "iso_weekday" SMALLINT NOT NULL,
      CONSTRAINT "PK_routine_weekdays" PRIMARY KEY ("routine_id", "iso_weekday"),
      CONSTRAINT "FK_routine_weekdays_routine" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE,
      CONSTRAINT "ck_routine_weekdays_iso_range" CHECK ("iso_weekday" BETWEEN 1 AND 7)
    )`);
    await queryRunner.query(`CREATE TABLE "routine_completions" (
      "routine_id" INTEGER NOT NULL,
      "occurrence_date" DATE NOT NULL,
      "completed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PK_routine_completions" PRIMARY KEY ("routine_id", "occurrence_date"),
      CONSTRAINT "FK_routine_completions_routine" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE
    )`);

    await queryRunner.query(`INSERT INTO "routines" (
      "id", "user_id", "title", "description", "starts_on", "is_active", "created_at", "updated_at"
    )
    SELECT habit."id", habit."user_id", habit."title", habit."description",
      COALESCE(
        (habit."created_at" AT TIME ZONE account."time_zone")::DATE,
        (CURRENT_TIMESTAMP AT TIME ZONE account."time_zone")::DATE
      ), TRUE, COALESCE(habit."created_at", CURRENT_TIMESTAMP), COALESCE(habit."created_at", CURRENT_TIMESTAMP)
    FROM "habits" AS habit
    JOIN "users" AS account ON account."id" = habit."user_id"`);
    await queryRunner.query(`INSERT INTO "routine_weekdays" ("routine_id", "iso_weekday")
      SELECT habit."id", weekday_row."iso_weekday"
      FROM "habits" AS habit
      CROSS JOIN GENERATE_SERIES(1, 7) AS weekday_row("iso_weekday")`);
    await queryRunner.query(`INSERT INTO "routine_completions" ("routine_id", "occurrence_date", "completed_at")
      SELECT logs."habit_id", logs."date", MAX(COALESCE(logs."created_at", CURRENT_TIMESTAMP))
      FROM "habit_logs" AS logs
      WHERE logs."completed" IS TRUE
      GROUP BY logs."habit_id", logs."date"
      ON CONFLICT ("routine_id", "occurrence_date") DO NOTHING`);
    await queryRunner.query(`SELECT setval(
      pg_get_serial_sequence('routines', 'id'),
      COALESCE((SELECT MAX("id") FROM "routines"), 1),
      EXISTS (SELECT 1 FROM "routines")
    )`);

    await queryRunner.query(`CREATE TABLE "reminders" (
      "id" SERIAL NOT NULL,
      "task_id" INTEGER,
      "routine_id" INTEGER,
      "scheduled_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "status" VARCHAR(16) NOT NULL DEFAULT 'scheduled',
      "sent_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PK_reminders_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_reminders_task" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_reminders_routine" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE,
      CONSTRAINT "ck_reminders_exactly_one_target" CHECK (NUM_NONNULLS("task_id", "routine_id") = 1),
      CONSTRAINT "ck_reminders_status" CHECK ("status" IN ('scheduled', 'sent', 'cancelled')),
      CONSTRAINT "ck_reminders_sent_time" CHECK (
        ("status" = 'sent' AND "sent_at" IS NOT NULL)
        OR ("status" IN ('scheduled', 'cancelled') AND "sent_at" IS NULL)
      )
    )`);

    await queryRunner.query(`ALTER TABLE "notifications"
      ADD COLUMN "reminder_id" INTEGER,
      ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
      ALTER COLUMN "is_read" SET DEFAULT FALSE`);
    await queryRunner.query(`UPDATE "notifications"
      SET "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
          "is_read" = COALESCE("is_read", FALSE)`);
    await queryRunner.query(`ALTER TABLE "notifications"
      ALTER COLUMN "created_at" SET NOT NULL,
      ALTER COLUMN "is_read" SET NOT NULL,
      ADD CONSTRAINT "FK_notifications_reminder" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE SET NULL`);

    await queryRunner.query(`UPDATE "notes"
      SET "content" = COALESCE("content", ''),
          "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
          "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP)`);
    await queryRunner.query(`ALTER TABLE "notes"
      ALTER COLUMN "content" SET NOT NULL,
      ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
      ALTER COLUMN "created_at" SET NOT NULL,
      ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP,
      ALTER COLUMN "updated_at" SET NOT NULL`);

    await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "FK_tasks_category"`);
    await queryRunner.query(`ALTER TABLE "tasks"
      DROP COLUMN "priority",
      DROP COLUMN "category_id",
      DROP COLUMN "due_date"`);

    for (const table of [
      "task_tags", "tags", "categories", "focus_sessions", "time_logs",
      "habit_logs", "habits", "milestones", "goals", "moods", "journal", "daily_core",
    ]) {
      await queryRunner.query(`DROP TABLE "${table}"`);
    }

    await queryRunner.query(`CREATE INDEX "ix_tasks_user_date_schedule" ON "tasks" ("user_id", "task_date", "scheduled_time", "id")`);
    await queryRunner.query(`CREATE INDEX "ix_routines_active_user" ON "routines" ("user_id", "id") WHERE "is_active" = TRUE`);
    await queryRunner.query(`CREATE INDEX "ix_routine_weekdays_by_day" ON "routine_weekdays" ("iso_weekday", "routine_id")`);
    await queryRunner.query(`CREATE INDEX "ix_routine_completions_by_date" ON "routine_completions" ("occurrence_date", "routine_id")`);
    await queryRunner.query(`CREATE INDEX "ix_reminders_due" ON "reminders" ("scheduled_at") WHERE "status" = 'scheduled'`);
    await queryRunner.query(`CREATE INDEX "ix_reminders_task" ON "reminders" ("task_id") WHERE "task_id" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "ix_reminders_routine" ON "reminders" ("routine_id") WHERE "routine_id" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "ix_notifications_user_history" ON "notifications" ("user_id", "created_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "ix_notifications_user_unread" ON "notifications" ("user_id", "created_at" DESC) WHERE "is_read" = FALSE`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_notifications_one_per_reminder" ON "notifications" ("reminder_id") WHERE "reminder_id" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "ix_notes_user_updated" ON "notes" ("user_id", "updated_at" DESC)`);
  }

  // DOWN MIGRATION
  public async down(): Promise<void> {
    throw new Error("This migration removes legacy module data and cannot be safely reversed. Restore a pre-migration backup instead.");
  }
}
