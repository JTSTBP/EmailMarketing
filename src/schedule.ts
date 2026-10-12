import { DateTime } from "luxon";
import { z } from "zod";
import type { Timing } from "./types";
export const timingSchema = z
  .object({
    days: z
      .array(z.number().int().min(0).max(365))
      .length(5)
      .refine(
        (d) => d[0] === 0 && d.every((n, i) => !i || n > d[i - 1]),
        "Use five increasing day offsets beginning with 0",
      ),
    timezone: z
      .string()
      .refine((t) => DateTime.now().setZone(t).isValid, "Unknown timezone"),
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    skipWeekends: z.boolean(),
  })
  .refine(
    (t) => t.endHour > t.startHour,
    "Sending window must end after it starts",
  );
export const defaultTiming: Timing = {
  days: [0, 3, 7, 12, 18],
  timezone: "Asia/Kolkata",
  startHour: 9,
  endHour: 18,
  skipWeekends: true,
};
export function businessTime(time: string, t: Timing): string {
  let d = DateTime.fromISO(time, { zone: "utc" }).setZone(t.timezone);
  for (let i = 0; i < 10; i++) {
    if (t.skipWeekends && d.weekday > 5) {
      d = d.plus({ days: 1 }).startOf("day");
      continue;
    }
    if (d.hour < t.startHour)
      d = d.set({ hour: t.startHour, minute: 0, second: 0, millisecond: 0 });
    if (d.hour >= t.endHour) {
      d = d.plus({ days: 1 }).startOf("day");
      continue;
    }
    return d.toUTC().toISO()!;
  }
  throw new Error("Could not schedule business time");
}
export function planned(start: string, step: number, t: Timing) {
  return businessTime(
    DateTime.fromISO(start)
      .setZone(t.timezone)
      .plus({ days: t.days[step] })
      .toUTC()
      .toISO()!,
    t,
  );
}
export function nextTime(
  start: string,
  step: number,
  t: Timing,
  lastSent?: string,
) {
  const nominal = planned(start, step, t);
  if (!lastSent || nominal > lastSent) return nominal;
  const spaced = DateTime.fromISO(lastSent)
    .setZone(t.timezone)
    .plus({ days: t.days[step] - t.days[step - 1] })
    .toUTC()
    .toISO()!;
  return businessTime(spaced, t);
}
export const dayKey = (time: string, zone: string) =>
  DateTime.fromISO(time).setZone(zone).toISODate()!;
