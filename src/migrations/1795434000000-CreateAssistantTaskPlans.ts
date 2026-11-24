import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAssistantTaskPlans1795434000000 implements MigrationInterface {
  name = "CreateAssistantTaskPlans1795434000000";
  transaction = true;

  // UP MIGRATION
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "assistant_messages" ADD COLUMN "metadata" JSONB`);

    await queryRunner.query(`CREATE TABLE "assistant_task_plans" (
      "id" UUID NOT NULL,
      "user_id" INTEGER NOT NULL,
      "conversation_id" UUID NOT NULL,
      "plan_date" DATE NOT NULL,
      "time_zone" VARCHAR(64) NOT NULL,
      "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "pk_assistant_task_plans" PRIMARY KEY ("id"),
      CONSTRAINT "ck_assistant_task_plans_status" CHECK ("status" IN ('draft', 'approved', 'cancelled')),
      CONSTRAINT "ck_assistant_task_plans_timezone" CHECK (BTRIM("time_zone") <> ''),
      CONSTRAINT "fk_assistant_task_plans_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "fk_assistant_task_plans_conversation" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE INDEX "ix_assistant_task_plans_user_conversation_date"
      ON "assistant_task_plans" ("user_id", "conversation_id", "plan_date")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_assistant_task_plans_draft_date"
      ON "assistant_task_plans" ("conversation_id", "plan_date") WHERE "status" = 'draft'`);

    await queryRunner.query(`CREATE TABLE "assistant_task_plan_items" (
      "id" UUID NOT NULL,
      "plan_id" UUID NOT NULL,
      "title" VARCHAR(255) NOT NULL,
      "description" TEXT,
      "start_time" TIME NOT NULL,
      "duration_minutes" INTEGER NOT NULL,
      "sort_order" INTEGER NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "pk_assistant_task_plan_items" PRIMARY KEY ("id"),
      CONSTRAINT "ck_assistant_task_plan_items_duration" CHECK ("duration_minutes" BETWEEN 1 AND 720),
      CONSTRAINT "ck_assistant_task_plan_items_sort_order" CHECK ("sort_order" >= 0),
      CONSTRAINT "uq_assistant_task_plan_items_order" UNIQUE ("plan_id", "sort_order"),
      CONSTRAINT "fk_assistant_task_plan_items_plan" FOREIGN KEY ("plan_id") REFERENCES "assistant_task_plans"("id") ON DELETE CASCADE
    )`);
  }

  // DOWN MIGRATION
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`LOCK TABLE "assistant_task_plans", "assistant_task_plan_items", "assistant_messages" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`DO $migration$
    BEGIN
      IF EXISTS (SELECT 1 FROM "assistant_task_plans")
        OR EXISTS (SELECT 1 FROM "assistant_messages" WHERE "metadata" IS NOT NULL) THEN
        RAISE EXCEPTION 'Assistant task plans or plan message metadata exist and cannot be removed by this migration';
      END IF;
    END;
    $migration$`);
    await queryRunner.query(`DROP TABLE "assistant_task_plan_items"`);
    await queryRunner.query(`DROP INDEX "uq_assistant_task_plans_draft_date"`);
    await queryRunner.query(`DROP INDEX "ix_assistant_task_plans_user_conversation_date"`);
    await queryRunner.query(`DROP TABLE "assistant_task_plans"`);
    await queryRunner.query(`ALTER TABLE "assistant_messages" DROP COLUMN "metadata"`);
  }
}
