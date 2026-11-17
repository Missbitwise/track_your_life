import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from "typeorm";
import { Routine } from "./Routine.js";
import { Task } from "./Task.js";
import { User } from "./User.js";

@Entity({ name: "reminders" })
@Check("ck_reminders_status", `"status" IN ('scheduled', 'sent', 'cancelled')`)
@Check("ck_reminders_sent_time", `("status" = 'sent' AND "sent_at" IS NOT NULL) OR ("status" IN ('scheduled', 'cancelled') AND "sent_at" IS NULL)`)
@Index("ix_reminders_due", ["scheduled_at"], { where: `"status" = 'scheduled'` })
@Index("ix_reminders_user", ["user_id"])
@Index("ix_reminders_task", ["task_id"], { where: `"task_id" IS NOT NULL` })
@Index("ix_reminders_routine", ["routine_id"], { where: `"routine_id" IS NOT NULL` })
export class Reminder {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "int", nullable: true })
  task_id!: number | null;

  @Column({ type: "int", nullable: true })
  routine_id!: number | null;

  @Column({ type: "timestamptz" })
  scheduled_at!: Date;

  @Column({ type: "varchar", length: 16, default: "scheduled" })
  status!: "scheduled" | "sent" | "cancelled";

  @Column({ type: "timestamptz", nullable: true })
  sent_at!: Date | null;

  @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  updated_at!: Date;

  @ManyToOne(() => User, (user) => user.reminders, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<User>;

  @ManyToOne(() => Task, (task) => task.reminders, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "task_id" })
  task!: Relation<Task> | null;

  @ManyToOne(() => Routine, (routine) => routine.reminders, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "routine_id" })
  routine!: Relation<Routine> | null;
}
