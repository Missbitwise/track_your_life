import { z } from "zod";

const positiveIntegerQuerySchema = (fallback: string) => z.preprocess(
  (value) => value === undefined ? fallback : value,
  z.string()
    .regex(/^[1-9]\d*$/, "Must be a positive integer")
    .transform(Number)
    .pipe(z.number().int().safe()),
);

const noteFields = {
  title: z.string().trim().min(1, "Title cannot be empty").max(255),
  content: z.string(),
};

export const createNoteBodySchema = z.object(noteFields).strict();

export const updateNoteBodySchema = z.object(noteFields)
  .partial()
  .strict()
  .refine((note) => Object.keys(note).length > 0, "At least one field must be provided");

export const listNotesQuerySchema = z.object({
  search: z.string().trim().optional(),
  page: positiveIntegerQuerySchema("1"),
  limit: positiveIntegerQuerySchema("10").pipe(z.number().max(100, "Limit cannot exceed 100")),
}).strict();

export type CreateNoteBody = z.infer<typeof createNoteBodySchema>;
export type UpdateNoteBody = z.infer<typeof updateNoteBodySchema>;
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;
