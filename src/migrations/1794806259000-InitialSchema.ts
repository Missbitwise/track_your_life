import type { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1794806259000 implements MigrationInterface {
  name = "InitialSchema1794806259000";

  // UP MIGRATION
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "users" ("id" SERIAL NOT NULL, "email" VARCHAR(255) NOT NULL, "password_hash" VARCHAR(255) NOT NULL, "first_name" VARCHAR(100), "last_name" VARCHAR(100), "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "UQ_users_email" UNIQUE ("email"), CONSTRAINT "PK_users_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "categories" ("id" SERIAL NOT NULL, "name" VARCHAR(100) NOT NULL, "color" VARCHAR(50), "user_id" INT NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PK_categories_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "tags" ("id" SERIAL NOT NULL, "name" VARCHAR(50) NOT NULL, "user_id" INT NOT NULL, CONSTRAINT "PK_tags_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "tasks" ("id" SERIAL NOT NULL, "title" VARCHAR(255) NOT NULL, "description" TEXT, "status" VARCHAR(50) DEFAULT 'PENDING', "priority" VARCHAR(50) DEFAULT 'MEDIUM', "due_date" TIMESTAMP WITH TIME ZONE, "user_id" INT NOT NULL, "category_id" INT, "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PK_tasks_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "task_tags" ("task_id" INT NOT NULL, "tag_id" INT NOT NULL, CONSTRAINT "PK_task_tags" PRIMARY KEY ("task_id", "tag_id"))`);
    await queryRunner.query(`CREATE TABLE "habits" ("id" SERIAL NOT NULL, "title" VARCHAR(255) NOT NULL, "description" TEXT, "frequency" VARCHAR(50) DEFAULT 'DAILY', "user_id" INT NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PK_habits_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "habit_logs" ("id" SERIAL NOT NULL, "habit_id" INT NOT NULL, "date" DATE NOT NULL, "completed" BOOLEAN DEFAULT FALSE, "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PK_habit_logs_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "focus_sessions" ("id" SERIAL NOT NULL, "user_id" INT NOT NULL, "task_id" INT, "duration" INT NOT NULL, "start_time" TIMESTAMP WITH TIME ZONE NOT NULL, "end_time" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_focus_sessions_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "time_logs" ("id" SERIAL NOT NULL, "user_id" INT NOT NULL, "task_id" INT, "start_time" TIMESTAMP WITH TIME ZONE NOT NULL, "end_time" TIMESTAMP WITH TIME ZONE, "description" TEXT, CONSTRAINT "PK_time_logs_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "notes" ("id" SERIAL NOT NULL, "title" VARCHAR(255) NOT NULL, "content" TEXT, "user_id" INT NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PK_notes_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "goals" ("id" SERIAL NOT NULL, "title" VARCHAR(255) NOT NULL, "description" TEXT, "target_date" DATE, "status" VARCHAR(50) DEFAULT 'IN_PROGRESS', "user_id" INT NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PK_goals_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "milestones" ("id" SERIAL NOT NULL, "goal_id" INT NOT NULL, "title" VARCHAR(255) NOT NULL, "target_date" DATE, "status" VARCHAR(50) DEFAULT 'PENDING', CONSTRAINT "PK_milestones_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "notifications" ("id" SERIAL NOT NULL, "user_id" INT NOT NULL, "message" TEXT NOT NULL, "is_read" BOOLEAN DEFAULT FALSE, "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PK_notifications_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "moods" ("id" SERIAL NOT NULL, "user_id" INT NOT NULL, "mood_score" INT, "note" TEXT, "date" DATE NOT NULL, CONSTRAINT "CHK_moods_mood_score" CHECK ("mood_score" BETWEEN 1 AND 10), CONSTRAINT "PK_moods_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "journal" ("id" SERIAL NOT NULL, "user_id" INT NOT NULL, "content" TEXT NOT NULL, "date" DATE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PK_journal_id" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE TABLE "daily_core" ("id" SERIAL NOT NULL, "user_id" INT NOT NULL, "date" DATE NOT NULL, "water_intake" INT DEFAULT 0, "sleep_hours" DECIMAL(4,2) DEFAULT 0.00, "meditation_minutes" INT DEFAULT 0, CONSTRAINT "UQ_daily_core_user_date" UNIQUE ("user_id", "date"), CONSTRAINT "PK_daily_core_id" PRIMARY KEY ("id"))`);

    await queryRunner.query(`ALTER TABLE "categories" ADD CONSTRAINT "FK_categories_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "tags" ADD CONSTRAINT "FK_tags_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_category" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE "task_tags" ADD CONSTRAINT "FK_task_tags_task" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "task_tags" ADD CONSTRAINT "FK_task_tags_tag" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "habits" ADD CONSTRAINT "FK_habits_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "habit_logs" ADD CONSTRAINT "FK_habit_logs_habit" FOREIGN KEY ("habit_id") REFERENCES "habits"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "focus_sessions" ADD CONSTRAINT "FK_focus_sessions_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "focus_sessions" ADD CONSTRAINT "FK_focus_sessions_task" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE "time_logs" ADD CONSTRAINT "FK_time_logs_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "time_logs" ADD CONSTRAINT "FK_time_logs_task" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE "notes" ADD CONSTRAINT "FK_notes_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "goals" ADD CONSTRAINT "FK_goals_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "milestones" ADD CONSTRAINT "FK_milestones_goal" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "notifications" ADD CONSTRAINT "FK_notifications_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "moods" ADD CONSTRAINT "FK_moods_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "journal" ADD CONSTRAINT "FK_journal_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "daily_core" ADD CONSTRAINT "FK_daily_core_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE`);
  }

  // DOWN MIGRATION
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ["daily_core", "journal", "moods", "notifications", "milestones", "goals", "notes", "time_logs", "focus_sessions", "habit_logs", "habits", "task_tags", "tasks", "tags", "categories", "users"]) {
      await queryRunner.query(`DROP TABLE "${table}"`);
    }
  }
}
