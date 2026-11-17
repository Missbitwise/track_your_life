import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from "typeorm";
import { Reminder } from "./Reminder.js";
import { User } from "./User.js";

@Entity({ name: "notifications" })
@Index("ix_notifications_user_history", { synchronize: false })
@Index("ix_notifications_user_unread", { synchronize: false })
@Index("uq_notifications_one_per_reminder", ["reminder_id"], { unique: true, where: `"reminder_id" IS NOT NULL` })
export class Notification {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "int", nullable: true })
  reminder_id!: number | null;

  @Column({ type: "text" })
  message!: string;

  @Column({ type: "boolean", default: false })
  is_read!: boolean;

  @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  created_at!: Date;

  @ManyToOne(() => User, (user) => user.notifications, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<User>;

  @ManyToOne(() => Reminder, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "reminder_id" })
  reminder!: Relation<Reminder> | null;
}
