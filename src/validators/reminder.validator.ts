import { z } from "zod";

const reminderDateTimeSchema = z.string()
  .datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), "scheduled_at must be a valid date and time");

const taskIdSchema = z.number().int().positive().safe();

export const createReminderBodySchema = z.object({
  scheduled_at: reminderDateTimeSchema,
  task_id: taskIdSchema.nullable().optional(),
}).strict();

export const updateReminderBodySchema = z.object({
  scheduled_at: reminderDateTimeSchema.optional(),
  task_id: taskIdSchema.nullable().optional(),
  status: z.enum(["scheduled", "sent", "cancelled"]).optional(),
}).strict().refine((reminder) => Object.keys(reminder).length > 0, "At least one field must be provided");

export type CreateReminderBody = z.infer<typeof createReminderBodySchema>;
export type UpdateReminderBody = z.infer<typeof updateReminderBodySchema>;
