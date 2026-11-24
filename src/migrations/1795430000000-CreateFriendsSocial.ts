import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateFriendsSocial1795430000000 implements MigrationInterface {
  name = "CreateFriendsSocial1795430000000";
  transaction = true;

  // UP MIGRATION
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "username" VARCHAR(32)`);
    await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "ck_users_username_format"
      CHECK ("username" IS NULL OR "username" ~ '^[A-Za-z0-9_]{3,32}$')`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_users_username_lower"
      ON "users" (LOWER("username")) WHERE "username" IS NOT NULL`);

    await queryRunner.query(`CREATE TABLE "friend_requests" (
      "id" UUID NOT NULL,
      "sender_id" INTEGER NOT NULL,
      "receiver_id" INTEGER NOT NULL,
      "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "responded_at" TIMESTAMPTZ,
      CONSTRAINT "pk_friend_requests" PRIMARY KEY ("id"),
      CONSTRAINT "ck_friend_requests_not_self" CHECK ("sender_id" <> "receiver_id"),
      CONSTRAINT "ck_friend_requests_status" CHECK ("status" IN ('pending', 'accepted', 'rejected', 'cancelled')),
      CONSTRAINT "ck_friend_requests_response_time" CHECK (("status" = 'pending' AND "responded_at" IS NULL) OR ("status" <> 'pending' AND "responded_at" IS NOT NULL)),
      CONSTRAINT "fk_friend_requests_sender" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "fk_friend_requests_receiver" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE INDEX "ix_friend_requests_sender" ON "friend_requests" ("sender_id")`);
    await queryRunner.query(`CREATE INDEX "ix_friend_requests_receiver" ON "friend_requests" ("receiver_id")`);
    await queryRunner.query(`CREATE INDEX "ix_friend_requests_status" ON "friend_requests" ("status")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_friend_requests_pending_pair"
      ON "friend_requests" (LEAST("sender_id", "receiver_id"), GREATEST("sender_id", "receiver_id"))
      WHERE "status" = 'pending'`);

    await queryRunner.query(`CREATE TABLE "friendships" (
      "id" UUID NOT NULL,
      "user_id" INTEGER NOT NULL,
      "friend_id" INTEGER NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "pk_friendships" PRIMARY KEY ("id"),
      CONSTRAINT "ck_friendships_canonical_pair" CHECK ("user_id" < "friend_id"),
      CONSTRAINT "uq_friendships_pair" UNIQUE ("user_id", "friend_id"),
      CONSTRAINT "fk_friendships_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "fk_friendships_friend" FOREIGN KEY ("friend_id") REFERENCES "users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE INDEX "ix_friendships_user" ON "friendships" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "ix_friendships_friend" ON "friendships" ("friend_id")`);

    await queryRunner.query(`CREATE TABLE "user_invitation_links" (
      "id" UUID NOT NULL,
      "user_id" INTEGER NOT NULL,
      "token_hash" VARCHAR(64) NOT NULL,
      "encrypted_token" TEXT NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "revoked_at" TIMESTAMPTZ,
      CONSTRAINT "pk_user_invitation_links" PRIMARY KEY ("id"),
      CONSTRAINT "uq_user_invitation_links_user" UNIQUE ("user_id"),
      CONSTRAINT "uq_user_invitation_links_token_hash" UNIQUE ("token_hash"),
      CONSTRAINT "fk_user_invitation_links_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    )`);

    await queryRunner.query(`CREATE TABLE "user_blocks" (
      "id" UUID NOT NULL,
      "blocker_id" INTEGER NOT NULL,
      "blocked_user_id" INTEGER NOT NULL,
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "pk_user_blocks" PRIMARY KEY ("id"),
      CONSTRAINT "ck_user_blocks_not_self" CHECK ("blocker_id" <> "blocked_user_id"),
      CONSTRAINT "uq_user_blocks_pair" UNIQUE ("blocker_id", "blocked_user_id"),
      CONSTRAINT "fk_user_blocks_blocker" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "fk_user_blocks_blocked" FOREIGN KEY ("blocked_user_id") REFERENCES "users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE INDEX "ix_user_blocks_blocker" ON "user_blocks" ("blocker_id")`);
    await queryRunner.query(`CREATE INDEX "ix_user_blocks_blocked" ON "user_blocks" ("blocked_user_id")`);
  }

  // DOWN MIGRATION
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`LOCK TABLE "friend_requests", "friendships", "user_invitation_links", "user_blocks", "users" IN ACCESS EXCLUSIVE MODE`);
    await queryRunner.query(`DO $migration$
    BEGIN
      IF EXISTS (SELECT 1 FROM "friend_requests") OR EXISTS (SELECT 1 FROM "friendships")
        OR EXISTS (SELECT 1 FROM "user_invitation_links") OR EXISTS (SELECT 1 FROM "user_blocks")
        OR EXISTS (SELECT 1 FROM "users" WHERE "username" IS NOT NULL) THEN
        RAISE EXCEPTION 'Friends data or usernames exist and cannot be removed by this migration';
      END IF;
    END;
    $migration$`);
    await queryRunner.query(`DROP INDEX "ix_user_blocks_blocked"`);
    await queryRunner.query(`DROP INDEX "ix_user_blocks_blocker"`);
    await queryRunner.query(`DROP TABLE "user_blocks"`);
    await queryRunner.query(`DROP TABLE "user_invitation_links"`);
    await queryRunner.query(`DROP INDEX "ix_friendships_friend"`);
    await queryRunner.query(`DROP INDEX "ix_friendships_user"`);
    await queryRunner.query(`DROP TABLE "friendships"`);
    await queryRunner.query(`DROP INDEX "uq_friend_requests_pending_pair"`);
    await queryRunner.query(`DROP INDEX "ix_friend_requests_status"`);
    await queryRunner.query(`DROP INDEX "ix_friend_requests_receiver"`);
    await queryRunner.query(`DROP INDEX "ix_friend_requests_sender"`);
    await queryRunner.query(`DROP TABLE "friend_requests"`);
    await queryRunner.query(`DROP INDEX "uq_users_username_lower"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "ck_users_username_format"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "username"`);
  }
}
