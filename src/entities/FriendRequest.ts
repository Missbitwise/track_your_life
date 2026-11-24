import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Relation } from "typeorm";
import { User } from "./User.js";

@Entity({ name: "friend_requests" })
@Check("ck_friend_requests_not_self", `"sender_id" <> "receiver_id"`)
@Check("ck_friend_requests_status", `"status" IN ('pending', 'accepted', 'rejected', 'cancelled')`)
@Check("ck_friend_requests_response_time", `("status" = 'pending' AND "responded_at" IS NULL) OR ("status" <> 'pending' AND "responded_at" IS NOT NULL)`)
@Index("ix_friend_requests_sender", ["sender_id"])
@Index("ix_friend_requests_receiver", ["receiver_id"])
@Index("ix_friend_requests_status", ["status"])
@Index("uq_friend_requests_pending_pair", { synchronize: false })
export class FriendRequest {
  @PrimaryColumn({ type: "uuid" }) id!: string;
  @Column({ type: "int" }) sender_id!: number;
  @Column({ type: "int" }) receiver_id!: number;
  @Column({ type: "varchar", length: 16, default: "pending" }) status!: "pending" | "accepted" | "rejected" | "cancelled";
  @CreateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" }) created_at!: Date;
  @Column({ type: "timestamptz", nullable: true }) responded_at!: Date | null;
  @ManyToOne(() => User, { onDelete: "CASCADE" }) @JoinColumn({ name: "sender_id" }) sender!: Relation<User>;
  @ManyToOne(() => User, { onDelete: "CASCADE" }) @JoinColumn({ name: "receiver_id" }) receiver!: Relation<User>;
}
