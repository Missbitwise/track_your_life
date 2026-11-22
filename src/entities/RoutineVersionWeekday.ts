import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Relation } from "typeorm";
import { RoutineVersion } from "./RoutineVersion.js";

@Entity({ name: "routine_version_weekdays" })
@Check("ck_routine_version_weekdays_range", `"iso_weekday" BETWEEN 1 AND 7`)
@Index("ix_routine_version_weekdays_day", ["iso_weekday", "routine_version_id"])
export class RoutineVersionWeekday {
  @PrimaryColumn({ type: "bigint" })
  routine_version_id!: string;

  @PrimaryColumn({ type: "smallint" })
  iso_weekday!: number;

  @ManyToOne(() => RoutineVersion, (version) => version.weekdays, { onDelete: "CASCADE" })
  @JoinColumn({ name: "routine_version_id" })
  routine_version!: Relation<RoutineVersion>;
}
