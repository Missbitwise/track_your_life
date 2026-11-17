import { z } from "zod";

const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  }, "Date must be a valid calendar date");

const timeSchema = z.string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/, "Time must use 24-hour HH:mm or HH:mm:ss format");

const weekdaysSchema = z.array(z.number().int().min(1).max(7))
  .min(1)
  .max(7)
  .refine((weekdays) => new Set(weekdays).size === weekdays.length, "Weekdays must not contain duplicates");

const routineFields = {
  title: z.string().trim().min(1).max(255),
  description: z.string().nullable().optional(),
  scheduled_time: timeSchema.nullable().optional(),
  starts_on: dateSchema,
  ends_on: dateSchema.nullable().optional(),
  is_active: z.boolean().optional(),
  weekdays: weekdaysSchema,
};

export const createRoutineBodySchema = z.object(routineFields).strict().superRefine((routine, context) => {
  if (routine.ends_on && routine.ends_on < routine.starts_on) {
    context.addIssue({ code: "custom", path: ["ends_on"], message: "End date must be on or after the start date" });
  }
});

export const updateRoutineBodySchema = z.object(routineFields)
  .partial()
  .strict()
  .refine((routine) => Object.keys(routine).length > 0, "At least one field must be provided")
  .superRefine((routine, context) => {
    if (routine.starts_on && routine.ends_on && routine.ends_on < routine.starts_on) {
      context.addIssue({ code: "custom", path: ["ends_on"], message: "End date must be on or after the start date" });
    }
  });

export type CreateRoutineBody = z.infer<typeof createRoutineBodySchema>;
export type UpdateRoutineBody = z.infer<typeof updateRoutineBodySchema>;
