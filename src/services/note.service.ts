import { appDataSource } from "../config/database.js";
import { Note } from "../entities/Note.js";
import type { CreateNoteBody, ListNotesQuery, UpdateNoteBody } from "../validators/note.validator.js";

export class NoteNotFoundError extends Error {
  constructor() {
    super("Note not found");
    this.name = "NoteNotFoundError";
  }
}

export interface NotesPagination {
  currentPage: number;
  limit: number;
  totalNotes: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface NotesPage {
  notes: Note[];
  pagination: NotesPagination;
}

export async function createNote(userId: number, input: CreateNoteBody): Promise<Note> {
  const repository = appDataSource.getRepository(Note);
  return repository.save(repository.create({
    user_id: userId,
    title: input.title,
    content: input.content,
  }));
}

export async function getNotesForUser(userId: number, query: ListNotesQuery): Promise<NotesPage> {
  const repository = appDataSource.getRepository(Note);
  const queryBuilder = repository.createQueryBuilder("note")
    .where("note.user_id = :userId", { userId });

  if (query.search) {
    queryBuilder.andWhere("(note.title ILIKE :search OR note.content ILIKE :search)", {
      search: `%${query.search}%`,
    });
  }

  const [notes, totalNotes] = await queryBuilder
    .orderBy("note.updated_at", "DESC")
    .addOrderBy("note.id", "DESC")
    .skip((query.page - 1) * query.limit)
    .take(query.limit)
    .getManyAndCount();

  const totalPages = Math.ceil(totalNotes / query.limit);
  return {
    notes,
    pagination: {
      currentPage: query.page,
      limit: query.limit,
      totalNotes,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  };
}

export async function getNoteForUser(userId: number, noteId: number): Promise<Note> {
  const note = await appDataSource.getRepository(Note).findOne({ where: { id: noteId, user_id: userId } });
  if (!note) throw new NoteNotFoundError();
  return note;
}

export async function updateNoteForUser(userId: number, noteId: number, input: UpdateNoteBody): Promise<Note> {
  const repository = appDataSource.getRepository(Note);
  const note = await repository.findOne({ where: { id: noteId, user_id: userId } });
  if (!note) throw new NoteNotFoundError();

  if (input.title !== undefined) note.title = input.title;
  if (input.content !== undefined) note.content = input.content;
  return repository.save(note);
}

export async function deleteNoteForUser(userId: number, noteId: number): Promise<void> {
  const result = await appDataSource.getRepository(Note).delete({ id: noteId, user_id: userId });
  if (!result.affected) throw new NoteNotFoundError();
}
