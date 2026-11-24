import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryColumn, Relation, UpdateDateColumn } from "typeorm";
import { AssistantMessage } from "./AssistantMessage.js";
import { User } from "./User.js";

@Entity({ name: "assistant_conversations" })
@Index("ix_assistant_conversations_user_updated", ["user_id", "updated_at", "id"])
export class AssistantConversation {
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Column({ type: "int" })
  user_id!: number;

  @Column({ type: "varchar", length: 160, nullable: true })
  title!: string | null;

  @CreateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  updated_at!: Date;

  @OneToMany(() => AssistantMessage, (message) => message.conversation)
  messages!: Relation<AssistantMessage[]>;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<User>;
}
