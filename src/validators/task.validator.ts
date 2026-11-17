import { z } from "zod";

export const taskDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  }, "Date must be a valid calendar date");

const scheduledTimeSchema = z.string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/, "Time must use 24-hour HH:mm or HH:mm:ss format");

const taskFields = {
  title: z.string().trim().min(1).max(255),
  description: z.string().nullable().optional(),
  task_date: taskDateSchema,
  scheduled_time: scheduledTimeSchema.nullable().optional(),
};

export const createTaskBodySchema = z.object(taskFields).strict();

export const updateTaskBodySchema = z.object(taskFields)
  .partial()
  .strict()
  .refine((task) => Object.keys(task).length > 0, "At least one field must be provided");

export const taskStatusBodySchema = z.object({
  status: z.enum(["pending", "completed"]),
}).strict();

export type CreateTaskBody = z.infer<typeof createTaskBodySchema>;
export type UpdateTaskBody = z.infer<typeof updateTaskBodySchema>;
export type TaskStatus = z.infer<typeof taskStatusBodySchema>["status"];
