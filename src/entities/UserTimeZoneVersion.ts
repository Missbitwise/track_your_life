import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, Unique } from "typeorm";
import { User } from "./User.js";

@Entity({ name: "user_time_zone_versions" })
@Check("ck_user_time_zone_versions_number", `"version_no" > 0`)
@Check("ck_user_time_zone_versions_name", `BTRIM("time_zone") <> ''`)
@Unique("uq_user_time_zone_versions_version", ["user_id", "version_no"])
@Index("ix_user_time_zone_versions_effective", ["user_id", "effective_from_date", "version_no"])
export class UserTimeZoneVersion {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "int" })
  version_no!: number;

  @Column({ type: "varchar", length: 64 })
  time_zone!: string;

  @Column({ type: "date" })
  effective_from_date!: string;

  @Column({ type: "timestamptz" })
  effective_at!: Date;

  @Column({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  recorded_at!: Date;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<User>;
}
