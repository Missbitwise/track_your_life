import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateRefreshTokens1794807789000 implements MigrationInterface {
  name = "CreateRefreshTokens1794807789000";

  // UP MIGRATION
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "refresh_tokens" (
      "id" SERIAL NOT NULL,
      "user_id" INT NOT NULL,
      "token_hash" VARCHAR(64) NOT NULL,
      "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
      "revoked_at" TIMESTAMP WITH TIME ZONE,
      "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "UQ_refresh_tokens_token_hash" UNIQUE ("token_hash"),
      CONSTRAINT "PK_refresh_tokens_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    )`);
  }

  // DOWN MIGRATION
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
  }
}
