import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAssistantConversations1795344202204 implements MigrationInterface {
  name = "CreateAssistantConversations1795344202204";
  transaction = true;

  // UP MIGRATION
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "assistant_conversations" (
      "id" UUID NOT NULL,
      "user_id" INTEGER NOT NULL,
      "title" VARCHAR(160),
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "pk_assistant_conversations" PRIMARY KEY ("id"),
      CONSTRAINT "fk_assistant_conversations_user" FOREIGN KEY ("user_id")
        REFERENCES "users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE INDEX "ix_assistant_conversations_user_updated"
      ON "assistant_conversations" ("user_id", "updated_at" DESC, "id" DESC)`);

    await queryRunner.query(`CREATE TABLE "assistant_messages" (
      "id" BIGSERIAL NOT NULL,
      "conversation_id" UUID NOT NULL,
      "role" VARCHAR(16) NOT NULL,
      "content" TEXT NOT NULL,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "pk_assistant_messages" PRIMARY KEY ("id"),
      CONSTRAINT "ck_assistant_messages_role" CHECK ("role" IN ('user', 'assistant')),
      CONSTRAINT "fk_assistant_messages_conversation" FOREIGN KEY ("conversation_id")
        REFERENCES "assistant_conversations"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE INDEX "ix_assistant_messages_conversation_created"
      ON "assistant_messages" ("conversation_id", "created_at" DESC, "id" DESC)`);
  }

  // DOWN MIGRATION
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`LOCK TABLE "assistant_conversations", "assistant_messages" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`DO $migration$
    BEGIN
      IF EXISTS (SELECT 1 FROM "assistant_conversations") THEN
        RAISE EXCEPTION 'Assistant conversation data exists and cannot be removed by this migration';
      END IF;
    END;
    $migration$`);
    await queryRunner.query(`DROP INDEX "ix_assistant_messages_conversation_created"`);
    await queryRunner.query(`DROP TABLE "assistant_messages"`);
    await queryRunner.query(`DROP INDEX "ix_assistant_conversations_user_updated"`);
    await queryRunner.query(`DROP TABLE "assistant_conversations"`);
  }
}
