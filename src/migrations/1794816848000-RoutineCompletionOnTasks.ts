import type { MigrationInterface, QueryRunner } from "typeorm";

export class RoutineCompletionOnTasks1794816848000 implements MigrationInterface {
  name = "RoutineCompletionOnTasks1794816848000";

  // UP MIGRATION
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tasks" ADD COLUMN "routine_id" INTEGER`);
    await queryRunner.query(`ALTER TABLE "tasks"
      ADD CONSTRAINT "FK_tasks_routine" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE SET NULL,
      ADD CONSTRAINT "uq_tasks_routine_date" UNIQUE ("routine_id", "task_date")`);

    await queryRunner.query(`INSERT INTO "tasks" (
      "user_id", "routine_id", "title", "description", "task_date", "scheduled_time",
      "status", "completed_at", "created_at", "updated_at"
    )
    SELECT routine."user_id", routine."id", routine."title", routine."description",
      completion."occurrence_date", routine."scheduled_time", 'completed', completion."completed_at",
      completion."completed_at", completion."completed_at"
    FROM "routine_completions" AS completion
    JOIN "routines" AS routine ON routine."id" = completion."routine_id"
    ON CONFLICT ("routine_id", "task_date") DO UPDATE
      SET "status" = 'completed', "completed_at" = EXCLUDED."completed_at", "updated_at" = EXCLUDED."updated_at"`);

    await queryRunner.query(`ALTER TABLE "reminders" ADD COLUMN "user_id" INTEGER`);
    await queryRunner.query(`UPDATE "reminders" AS reminder
      SET "user_id" = task."user_id"
      FROM "tasks" AS task
      WHERE reminder."task_id" = task."id"`);
    await queryRunner.query(`UPDATE "reminders" AS reminder
      SET "user_id" = routine."user_id"
      FROM "routines" AS routine
      WHERE reminder."routine_id" = routine."id"`);
    await queryRunner.query(`ALTER TABLE "reminders"
      ALTER COLUMN "user_id" SET NOT NULL,
      ADD CONSTRAINT "FK_reminders_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
      DROP CONSTRAINT "ck_reminders_exactly_one_target"`);
    await queryRunner.query(`CREATE INDEX "ix_reminders_user" ON "reminders" ("user_id")`);
    await queryRunner.query(`DROP TABLE "routine_completions"`);
  }

  // DOWN MIGRATION
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $migration$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM public.reminders
        WHERE task_id IS NULL AND routine_id IS NULL
      ) THEN
        RAISE EXCEPTION 'Unassociated reminders cannot be represented by the previous schema';
      END IF;
    END;
    $migration$`);

    await queryRunner.query(`CREATE TABLE "routine_completions" (
      "routine_id" INTEGER NOT NULL,
      "occurrence_date" DATE NOT NULL,
      "completed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PK_routine_completions" PRIMARY KEY ("routine_id", "occurrence_date"),
      CONSTRAINT "FK_routine_completions_routine" FOREIGN KEY ("routine_id") REFERENCES "routines"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`INSERT INTO "routine_completions" ("routine_id", "occurrence_date", "completed_at")
      SELECT "routine_id", "task_date", "completed_at"
      FROM "tasks"
      WHERE "routine_id" IS NOT NULL AND "status" = 'completed'`);
    await queryRunner.query(`CREATE INDEX "ix_routine_completions_by_date" ON "routine_completions" ("occurrence_date", "routine_id")`);

    await queryRunner.query(`ALTER TABLE "reminders"
      DROP CONSTRAINT "FK_reminders_user",
      DROP COLUMN "user_id",
      ADD CONSTRAINT "ck_reminders_exactly_one_target" CHECK (NUM_NONNULLS("task_id", "routine_id") = 1)`);
    await queryRunner.query(`DROP INDEX "ix_reminders_user"`);
    await queryRunner.query(`ALTER TABLE "tasks"
      DROP CONSTRAINT "FK_tasks_routine",
      DROP CONSTRAINT "uq_tasks_routine_date",
      DROP COLUMN "routine_id"`);
  }
}
