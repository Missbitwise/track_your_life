import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Relation } from "typeorm";
import { Routine } from "./Routine.js";

@Entity({ name: "routine_weekdays" })
@Check("ck_routine_weekdays_iso_range", `"iso_weekday" BETWEEN 1 AND 7`)
@Index("ix_routine_weekdays_by_day", ["iso_weekday", "routine_id"])
export class RoutineWeekday {
  @PrimaryColumn({ type: "int" })
  routine_id!: number;

  @PrimaryColumn({ type: "smallint" })
  iso_weekday!: number;

  @ManyToOne(() => Routine, (routine) => routine.weekdays, { onDelete: "CASCADE" })
  @JoinColumn({ name: "routine_id" })
  routine!: Relation<Routine>;
}
