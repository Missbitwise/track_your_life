import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn, Relation, Unique } from "typeorm";
import { User } from "./User.js";

@Entity({ name: "user_invitation_links" })
@Unique("uq_user_invitation_links_user", ["user_id"])
@Unique("uq_user_invitation_links_token_hash", ["token_hash"])
export class UserInvitationLink {
  @PrimaryColumn({ type: "uuid" }) id!: string;
  @Column({ type: "int" }) user_id!: number;
  @Column({ type: "varchar", length: 64 }) token_hash!: string;
  @Column({ type: "text" }) encrypted_token!: string;
  @CreateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" }) created_at!: Date;
  @Column({ type: "timestamptz", nullable: true }) revoked_at!: Date | null;
  @ManyToOne(() => User, { onDelete: "CASCADE" }) @JoinColumn({ name: "user_id" }) user!: Relation<User>;
}
