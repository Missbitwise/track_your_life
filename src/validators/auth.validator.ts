import { z } from "zod";

const passwordSchema = z.string().min(8).superRefine((password, context) => {
  if (Buffer.byteLength(password, "utf8") > 72) {
    context.addIssue({ code: "custom", message: "Password must be no more than 72 UTF-8 bytes" });
  }
});

export const registerBodySchema = z.object({
  email: z.string().trim().email().max(255).transform((email) => email.toLowerCase()),
  password: passwordSchema,
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/).optional(),
}).strict();

export const loginBodySchema = z.object({
  email: z.string().trim().email().max(255).transform((email) => email.toLowerCase()),
  password: passwordSchema,
}).strict();

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1).max(4096),
}).strict();

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
