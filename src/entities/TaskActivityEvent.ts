import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, Unique } from "typeorm";
import { User } from "./User.js";

export type TaskActivityEventType =
  | "baseline"
  | "created"
  | "completed"
  | "reopened"
  | "rescheduled"
  | "updated"
  | "deleted";

export interface TaskActivitySnapshot {
  title: string;
  description: string | null;
  task_date: string;
  scheduled_time: string | null;
  status: "pending" | "completed";
  completed_at: string | null;
  routine_id: number | null;
  routine_occurrence_date: string | null;
  change_source?: "routine_reconciliation";
}

@Entity({ name: "task_activity_events" })
@Check("ck_task_activity_events_sequence", `"event_sequence" > 0`)
@Check("ck_task_activity_events_type", `"event_type" IN ('baseline', 'created', 'completed', 'reopened', 'rescheduled', 'updated', 'deleted')`)
@Check("ck_task_activity_events_status", `"status" IN ('pending', 'completed')`)
@Check("ck_task_activity_events_completion", `("status" = 'completed' AND "completed_at" IS NOT NULL) OR ("status" = 'pending' AND "completed_at" IS NULL)`)
@Check("ck_task_activity_events_transition", `("event_type" <> 'completed' OR "status" = 'completed') AND ("event_type" <> 'reopened' OR "status" = 'pending')`)
@Check("ck_task_activity_events_timezone", `BTRIM("time_zone") <> ''`)
@Check("ck_task_activity_events_before_snapshot", `("event_type" IN ('baseline', 'created') AND "before_snapshot" IS NULL) OR ("event_type" NOT IN ('baseline', 'created') AND "before_snapshot" IS NOT NULL)`)
@Check("ck_task_activity_events_before_snapshot_object", `"before_snapshot" IS NULL OR jsonb_typeof("before_snapshot") = 'object'`)
@Check("ck_task_activity_events_routine_origin", `("routine_id_snapshot" IS NULL AND "routine_occurrence_date" IS NULL) OR ("routine_id_snapshot" IS NOT NULL AND "routine_occurrence_date" IS NOT NULL)`)
@Unique("uq_task_activity_events_sequence", ["user_id", "task_id", "event_sequence"])
@Index("ix_task_activity_events_user_date", ["user_id", "task_date", "event_at"])
@Index("ix_task_activity_events_user_activity_date", ["user_id", "activity_local_date", "event_type"])
export class TaskActivityEvent {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ type: "int" })
  user_id!: number;

  // Logical historical identifiers intentionally have no relation to live task/routine rows.
  @Column({ type: "int" })
  task_id!: number;

  @Column({ type: "int" })
  event_sequence!: number;

  @Column({ type: "varchar", length: 16 })
  event_type!: TaskActivityEventType;

  @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  event_at!: Date;

  @Column({ type: "date" })
  activity_local_date!: string;

  @Column({ type: "varchar", length: 64 })
  time_zone!: string;

  @Column({ type: "varchar", length: 255 })
  task_title!: string;

  @Column({ type: "text", nullable: true })
  task_description!: string | null;

  @Column({ type: "date" })
  task_date!: string;

  @Column({ type: "time", nullable: true })
  scheduled_time!: string | null;

  @Column({ type: "varchar", length: 16 })
  status!: "pending" | "completed";

  @Column({ type: "timestamptz", nullable: true })
  completed_at!: Date | null;

  @Column({ type: "int", nullable: true })
  routine_id_snapshot!: number | null;

  @Column({ type: "date", nullable: true })
  routine_occurrence_date!: string | null;

  @Column({ type: "jsonb", nullable: true })
  before_snapshot!: TaskActivitySnapshot | null;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<User>;
}
