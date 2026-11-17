import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Relation, Unique, UpdateDateColumn } from "typeorm";
import { Reminder } from "./Reminder.js";
import { Routine } from "./Routine.js";
import { User } from "./User.js";

@Entity({ name: "tasks" })
@Check("ck_tasks_status", `"status" IN ('pending', 'completed')`)
@Check("ck_tasks_completion_time", `("status" = 'completed' AND "completed_at" IS NOT NULL) OR ("status" = 'pending' AND "completed_at" IS NULL)`)
@Index("ix_tasks_user_date_schedule", ["user_id", "task_date", "scheduled_time", "id"])
@Unique("uq_tasks_routine_date", ["routine_id", "task_date"])
export class Task {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "int", nullable: true })
  routine_id!: number | null;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "date" })
  task_date!: string;

  @Column({ type: "time", nullable: true })
  scheduled_time!: string | null;

  @Column({ type: "varchar", length: 16, default: "pending" })
  status!: "pending" | "completed";

  @Column({ type: "timestamptz", nullable: true })
  completed_at!: Date | null;

  @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  updated_at!: Date;

  @ManyToOne(() => User, (user) => user.tasks, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<User>;

  @ManyToOne(() => Routine, (routine) => routine.generated_tasks, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "routine_id" })
  routine!: Relation<Routine> | null;

  @OneToMany(() => Reminder, (reminder) => reminder.task)
  reminders!: Reminder[];
}
