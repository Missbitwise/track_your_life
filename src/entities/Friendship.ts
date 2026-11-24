import { Check, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Relation, Unique, Column } from "typeorm";
import { User } from "./User.js";

@Entity({ name: "friendships" })
@Check("ck_friendships_canonical_pair", `"user_id" < "friend_id"`)
@Unique("uq_friendships_pair", ["user_id", "friend_id"])
@Index("ix_friendships_user", ["user_id"])
@Index("ix_friendships_friend", ["friend_id"])
export class Friendship {
  @PrimaryColumn({ type: "uuid" }) id!: string;
  @Column({ type: "int" }) user_id!: number;
  @Column({ type: "int" }) friend_id!: number;
  @CreateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" }) created_at!: Date;
  @ManyToOne(() => User, { onDelete: "CASCADE" }) @JoinColumn({ name: "user_id" }) user!: Relation<User>;
  @ManyToOne(() => User, { onDelete: "CASCADE" }) @JoinColumn({ name: "friend_id" }) friend!: Relation<User>;
}
