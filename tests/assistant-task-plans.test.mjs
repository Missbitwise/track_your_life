import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantPlanValidationError, validatePlanInput } from "../dist/services/assistant-task-plans.service.js";

test("daily plan input is validated and normalized into chronological order", () => {
  const plan = validatePlanInput({
    planDate: "2026-12-01",
    tasks: [
      { title: "Study", startTime: "10:00", durationMinutes: 60 },
      { title: "Exercise", description: "At home", startTime: "07:00", durationMinutes: 30 },
    ],
  });

  assert.deepEqual(plan.tasks.map(({ title, startTime, sortOrder }) => ({ title, startTime, sortOrder })), [
    { title: "Exercise", startTime: "07:00", sortOrder: 0 },
    { title: "Study", startTime: "10:00", sortOrder: 1 },
  ]);
});

test("daily plans reject overlapping tasks", () => {
  assert.throws(() => validatePlanInput({
    planDate: "2026-12-01",
    tasks: [
      { title: "Study", startTime: "09:00", durationMinutes: 90 },
      { title: "Exercise", startTime: "10:00", durationMinutes: 30 },
    ],
  }), (error) => error instanceof AssistantPlanValidationError && /overlaps/.test(error.message));
});

test("daily plans reject invalid dates, times, durations, and work extending past midnight", () => {
  for (const input of [
    { planDate: "2026-02-30", tasks: [{ title: "Study", startTime: "09:00", durationMinutes: 30 }] },
    { planDate: "2026-12-01", tasks: [{ title: "Study", startTime: "24:00", durationMinutes: 30 }] },
    { planDate: "2026-12-01", tasks: [{ title: "Study", startTime: "09:00", durationMinutes: 0 }] },
  ]) assert.throws(() => validatePlanInput(input), AssistantPlanValidationError);

  assert.throws(() => validatePlanInput({
    planDate: "2026-12-01",
    tasks: [{ title: "Late task", startTime: "23:30", durationMinutes: 60 }],
  }), (error) => error instanceof AssistantPlanValidationError && /past the selected calendar day/.test(error.message));
});
