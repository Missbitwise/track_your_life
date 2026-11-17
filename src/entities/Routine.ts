import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Relation, UpdateDateColumn } from "typeorm";
import { Reminder } from "./Reminder.js";
import { RoutineWeekday } from "./RoutineWeekday.js";
import { Task } from "./Task.js";
import { User } from "./User.js";

@Entity({ name: "routines" })
@Check("ck_routines_date_range", `"ends_on" IS NULL OR "ends_on" >= "starts_on"`)
@Index("ix_routines_active_user", ["user_id", "id"], { where: `"is_active" = TRUE` })
export class Routine {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "time", nullable: true })
  scheduled_time!: string | null;

  @Column({ type: "date" })
  starts_on!: string;

  @Column({ type: "date", nullable: true })
  ends_on!: string | null;

  @Column({ type: "boolean", default: true })
  is_active!: boolean;

  @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  updated_at!: Date;

  @ManyToOne(() => User, (user) => user.routines, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<User>;

  @OneToMany(() => RoutineWeekday, (weekday) => weekday.routine)
  weekdays!: RoutineWeekday[];

  @OneToMany(() => Task, (task) => task.routine)
  generated_tasks!: Task[];

  @OneToMany(() => Reminder, (reminder) => reminder.routine)
  reminders!: Reminder[];
}
