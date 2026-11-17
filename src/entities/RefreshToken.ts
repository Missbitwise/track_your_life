import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation, Unique } from "typeorm";
import { User } from "./User.js";

@Entity({ name: "refresh_tokens" })
@Unique("UQ_refresh_tokens_token_hash", ["token_hash"])
@Index("ix_refresh_tokens_active_user", ["user_id", "expires_at"], { where: `"revoked_at" IS NULL` })
export class RefreshToken {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "varchar", length: 64 })
  token_hash!: string;

  @Column({ type: "timestamptz" })
  expires_at!: Date;

  @Column({ type: "timestamptz", nullable: true })
  revoked_at!: Date | null;

  @CreateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  created_at!: Date;

  @ManyToOne(() => User, (user) => user.refresh_tokens, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<User>;
}
