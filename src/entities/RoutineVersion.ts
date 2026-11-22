import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Relation, Unique } from "typeorm";
import { User } from "./User.js";
import { RoutineVersionWeekday } from "./RoutineVersionWeekday.js";

export type RoutineVersionChangeType = "baseline" | "created" | "updated" | "deleted";

@Entity({ name: "routine_versions" })
@Check("ck_routine_versions_number", `"version_no" > 0`)
@Check("ck_routine_versions_change_type", `"change_type" IN ('baseline', 'created', 'updated', 'deleted')`)
@Check("ck_routine_versions_schedule_range", `"ends_on" IS NULL OR "ends_on" >= "starts_on"`)
@Check("ck_routine_versions_timezone", `BTRIM("time_zone") <> ''`)
@Unique("uq_routine_versions_version", ["user_id", "routine_id", "version_no"])
@Index("ix_routine_versions_user_effective", ["user_id", "routine_id", "effective_from_date", "version_no"])
export class RoutineVersion {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ type: "int" })
  user_id!: number;

  // Logical historical identifier; it deliberately survives deletion of the live routine.
  @Column({ type: "int" })
  routine_id!: number;

  @Column({ type: "int" })
  version_no!: number;

  @Column({ type: "varchar", length: 16 })
  change_type!: RoutineVersionChangeType;

  @Column({ type: "date" })
  effective_from_date!: string;

  @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  recorded_at!: Date;

  @Column({ type: "varchar", length: 64 })
  time_zone!: string;

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

  @Column({ type: "boolean" })
  is_active!: boolean;

  @OneToMany(() => RoutineVersionWeekday, (weekday) => weekday.routine_version)
  weekdays!: RoutineVersionWeekday[];

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<User>;
}
