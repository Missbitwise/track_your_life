import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Relation, Unique, UpdateDateColumn } from "typeorm";
import { AssistantTaskPlan } from "./AssistantTaskPlan.js";

@Entity({ name: "assistant_task_plan_items" })
@Check("ck_assistant_task_plan_items_duration", `"duration_minutes" BETWEEN 1 AND 720`)
@Check("ck_assistant_task_plan_items_sort_order", `"sort_order" >= 0`)
@Unique("uq_assistant_task_plan_items_order", ["plan_id", "sort_order"])
export class AssistantTaskPlanItem {
  @PrimaryColumn({ type: "uuid" }) id!: string;
  @Column({ type: "uuid" }) plan_id!: string;
  @Column({ type: "varchar", length: 255 }) title!: string;
  @Column({ type: "text", nullable: true }) description!: string | null;
  @Column({ type: "time" }) start_time!: string;
  @Column({ type: "int" }) duration_minutes!: number;
  @Column({ type: "int" }) sort_order!: number;
  @CreateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" }) created_at!: Date;
  @UpdateDateColumn({ type: "timestamptz", default: () => "CURRENT_TIMESTAMP" }) updated_at!: Date;
  @ManyToOne(() => AssistantTaskPlan, (plan) => plan.items, { onDelete: "CASCADE" }) @JoinColumn({ name: "plan_id" }) plan!: Relation<AssistantTaskPlan>;
}
