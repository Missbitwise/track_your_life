import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Relation, Unique } from "typeorm";
import { User } from "./User.js";

@Entity({ name: "user_blocks" })
@Check("ck_user_blocks_not_self", `"blocker_id" <> "blocked_user_id"`)
@Unique("uq_user_blocks_pair", ["blocker_id", "blocked_user_id"])
@Index("ix_user_blocks_blocker", ["blocker_id"])
@Index("ix_user_blocks_blocked", ["blocked_user_id"])
export class UserBlock {
  @PrimaryColumn({ type: "uuid" }) id!: string;
  @Column({ type: "int" }) blocker_id!: number;
  @Column({ type: "int" }) blocked_user_id!: number;
  @CreateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" }) created_at!: Date;
  @ManyToOne(() => User, { onDelete: "CASCADE" }) @JoinColumn({ name: "blocker_id" }) blocker!: Relation<User>;
  @ManyToOne(() => User, { onDelete: "CASCADE" }) @JoinColumn({ name: "blocked_user_id" }) blocked_user!: Relation<User>;
}
