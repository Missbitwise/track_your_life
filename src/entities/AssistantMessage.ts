import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from "typeorm";
import { AssistantConversation } from "./AssistantConversation.js";

export type AssistantMessageRole = "user" | "assistant";

@Entity({ name: "assistant_messages" })
@Check("ck_assistant_messages_role", `"role" IN ('user', 'assistant')`)
@Index("ix_assistant_messages_conversation_created", ["conversation_id", "created_at", "id"])
export class AssistantMessage {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ type: "uuid" })
  conversation_id!: string;

  @Column({ type: "varchar", length: 16 })
  role!: AssistantMessageRole;

  @Column({ type: "text" })
  content!: string;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  created_at!: Date;

  @ManyToOne(() => AssistantConversation, (conversation) => conversation.messages, { onDelete: "CASCADE" })
  @JoinColumn({ name: "conversation_id" })
  conversation!: Relation<AssistantConversation>;
}
