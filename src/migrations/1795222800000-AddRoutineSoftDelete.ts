import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddRoutineSoftDelete1795222800000 implements MigrationInterface {
  name = "AddRoutineSoftDelete1795222800000";
  transaction = true;

  // UP MIGRATION
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "routines" ADD COLUMN "deleted_at" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`CREATE INDEX "ix_routines_user_not_deleted"
      ON "routines" ("user_id", "id") WHERE "deleted_at" IS NULL`);
  }

  // DOWN MIGRATION
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`LOCK TABLE "routines" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`DO $migration$
    BEGIN
      IF EXISTS (SELECT 1 FROM "routines" WHERE "deleted_at" IS NOT NULL) THEN
        RAISE EXCEPTION 'Soft-deleted routines exist and cannot be restored by dropping deleted_at';
      END IF;
    END;
    $migration$`);
    await queryRunner.query(`DROP INDEX "ix_routines_user_not_deleted"`);
    await queryRunner.query(`ALTER TABLE "routines" DROP COLUMN "deleted_at"`);
  }
}
