import { z } from "zod";

function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const updateTimeZoneBodySchema = z.object({
  time_zone: z.string()
    .trim()
    .min(1)
    .max(64)
    .refine(isValidIanaTimeZone, "time_zone must be a valid IANA timezone"),
}).strict();

export type UpdateTimeZoneBody = z.infer<typeof updateTimeZoneBodySchema>;
