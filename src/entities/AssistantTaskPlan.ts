import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryColumn, Relation, UpdateDateColumn } from "typeorm";
import { AssistantConversation } from "./AssistantConversation.js";
import { AssistantTaskPlanItem } from "./AssistantTaskPlanItem.js";
import { User } from "./User.js";

@Entity({ name: "assistant_task_plans" })
@Check("ck_assistant_task_plans_status", `"status" IN ('draft', 'approved', 'cancelled')`)
@Check("ck_assistant_task_plans_timezone", `BTRIM("time_zone") <> ''`)
@Index("ix_assistant_task_plans_user_conversation_date", ["user_id", "conversation_id", "plan_date"])
@Index("uq_assistant_task_plans_draft_date", ["conversation_id", "plan_date"], { unique: true, where: `"status" = 'draft'` })
export class AssistantTaskPlan {
  @PrimaryColumn({ type: "uuid" }) id!: string;
  @Column({ type: "int" }) user_id!: number;
  @Column({ type: "uuid" }) conversation_id!: string;
  @Column({ type: "date" }) plan_date!: string;
  @Column({ type: "varchar", length: 64 }) time_zone!: string;
  @Column({ type: "varchar", length: 16, default: "draft" }) status!: "draft" | "approved" | "cancelled";
  @CreateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" }) created_at!: Date;
  @UpdateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" }) updated_at!: Date;
  @ManyToOne(() => User, { onDelete: "CASCADE" }) @JoinColumn({ name: "user_id" }) user!: Relation<User>;
  @ManyToOne(() => AssistantConversation, { onDelete: "CASCADE" }) @JoinColumn({ name: "conversation_id" }) conversation!: Relation<AssistantConversation>;
  @OneToMany(() => AssistantTaskPlanItem, (item) => item.plan) items!: Relation<AssistantTaskPlanItem[]>;
}
