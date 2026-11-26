import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddGoogleAuthentication1795440000000 implements MigrationInterface {
  name = "AddGoogleAuthentication1795440000000";
  transaction = true;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "google_id" VARCHAR(255)`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_google_id" ON "users" ("google_id") WHERE "google_id" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DO $migration$
    BEGIN
      IF EXISTS (SELECT 1 FROM "users" WHERE "password_hash" IS NULL OR "google_id" IS NOT NULL) THEN
        RAISE EXCEPTION 'Google-only accounts exist and cannot be removed by this migration';
      END IF;
    END;
    $migration$`);
    await queryRunner.query(`DROP INDEX "uq_users_google_id"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "google_id"`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL`);
  }
}
