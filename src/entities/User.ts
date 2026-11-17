import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { Note } from "./Note.js";
import { Notification } from "./Notification.js";
import { Reminder } from "./Reminder.js";
import { RefreshToken } from "./RefreshToken.js";
import { Routine } from "./Routine.js";
import { Task } from "./Task.js";

@Index("uq_users_email_lower", { synchronize: false })
@Entity({ name: "users" })
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 255 })
  email!: string;

  @Column({ type: "varchar", length: 255 })
  password_hash!: string;

  @Column({ type: "varchar", length: 100, nullable: true })
  first_name!: string | null;

  @Column({ type: "varchar", length: 100, nullable: true })
  last_name!: string | null;

  @Column({ type: "varchar", length: 64, default: "UTC" })
  time_zone!: string;

  @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  updated_at!: Date;

  @OneToMany(() => RefreshToken, (refreshToken) => refreshToken.user)
  refresh_tokens!: RefreshToken[];

  @OneToMany(() => Task, (task) => task.user)
  tasks!: Task[];

  @OneToMany(() => Routine, (routine) => routine.user)
  routines!: Routine[];

  @OneToMany(() => Reminder, (reminder) => reminder.user)
  reminders!: Reminder[];

  @OneToMany(() => Notification, (notification) => notification.user)
  notifications!: Notification[];

  @OneToMany(() => Note, (note) => note.user)
  notes!: Note[];
}
