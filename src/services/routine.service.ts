import { appDataSource } from "../config/database.js";
import { Routine } from "../entities/Routine.js";
import { RoutineWeekday } from "../entities/RoutineWeekday.js";
import type { CreateRoutineBody, UpdateRoutineBody } from "../validators/routine.validator.js";

export class RoutineNotFoundError extends Error {
  constructor() {
    super("Routine not found");
    this.name = "RoutineNotFoundError";
  }
}

export class RoutineDateRangeError extends Error {
  constructor() {
    super("End date must be on or after the start date");
    this.name = "RoutineDateRangeError";
  }
}

function sortWeekdays(routine: Routine): Routine {
  routine.weekdays?.sort((left, right) => left.iso_weekday - right.iso_weekday);
  return routine;
}

export async function createRoutine(userId: number, input: CreateRoutineBody): Promise<Routine> {
  if (input.ends_on && input.ends_on < input.starts_on) throw new RoutineDateRangeError();

  return appDataSource.transaction(async (manager) => {
    const routineRepository = manager.getRepository(Routine);
    const routine = routineRepository.create({
      user_id: userId,
      title: input.title,
      description: input.description ?? null,
      scheduled_time: input.scheduled_time ?? null,
      starts_on: input.starts_on,
      ends_on: input.ends_on ?? null,
      is_active: input.is_active ?? true,
    });
    const savedRoutine = await routineRepository.save(routine);
    const weekdays = await manager.getRepository(RoutineWeekday).save(
      input.weekdays.map((iso_weekday) => ({ routine_id: savedRoutine.id, iso_weekday })),
    );

    savedRoutine.weekdays = weekdays;
    return sortWeekdays(savedRoutine);
  });
}

export async function getRoutinesForUser(userId: number): Promise<Routine[]> {
  const routines = await appDataSource.getRepository(Routine).find({
    where: { user_id: userId },
    relations: { weekdays: true },
    order: { starts_on: "ASC", id: "ASC" },
  });
  return routines.map(sortWeekdays);
}

export async function getRoutineForUser(userId: number, routineId: number): Promise<Routine> {
  const routine = await appDataSource.getRepository(Routine).findOne({
    where: { id: routineId, user_id: userId },
    relations: { weekdays: true },
  });
  if (!routine) throw new RoutineNotFoundError();
  return sortWeekdays(routine);
}

export async function updateRoutineForUser(
  userId: number,
  routineId: number,
  input: UpdateRoutineBody,
): Promise<Routine> {
  return appDataSource.transaction(async (manager) => {
    const routineRepository = manager.getRepository(Routine);
    const routine = await routineRepository.findOne({
      where: { id: routineId, user_id: userId },
      relations: { weekdays: true },
      lock: { mode: "pessimistic_write" },
    });
    if (!routine) throw new RoutineNotFoundError();

    const nextStartsOn = input.starts_on ?? routine.starts_on;
    const nextEndsOn = input.ends_on === undefined ? routine.ends_on : input.ends_on;
    if (nextEndsOn && nextEndsOn < nextStartsOn) throw new RoutineDateRangeError();

    if (input.title !== undefined) routine.title = input.title;
    if (input.description !== undefined) routine.description = input.description;
    if (input.scheduled_time !== undefined) routine.scheduled_time = input.scheduled_time;
    if (input.starts_on !== undefined) routine.starts_on = input.starts_on;
    if (input.ends_on !== undefined) routine.ends_on = input.ends_on;
    if (input.is_active !== undefined) routine.is_active = input.is_active;

    const savedRoutine = await routineRepository.save(routine);
    if (input.weekdays !== undefined) {
      const weekdayRepository = manager.getRepository(RoutineWeekday);
      await weekdayRepository.delete({ routine_id: routine.id });
      savedRoutine.weekdays = await weekdayRepository.save(
        input.weekdays.map((iso_weekday) => ({ routine_id: routine.id, iso_weekday })),
      );
    }

    return sortWeekdays(savedRoutine);
  });
}

export async function deleteRoutineForUser(userId: number, routineId: number): Promise<void> {
  const result = await appDataSource.getRepository(Routine).delete({ id: routineId, user_id: userId });
  if (!result.affected) throw new RoutineNotFoundError();
}
