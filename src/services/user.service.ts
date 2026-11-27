import { appDataSource } from "../config/database.js";
import { User } from "../entities/User.js";

export interface CurrentUser {
  id: number;
  email: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: Date;
}

export async function findCurrentUser(userId: number): Promise<CurrentUser | null> {
  const user = await appDataSource.getRepository(User).findOne({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      first_name: true,
      last_name: true,
      created_at: true,
    },
  });

  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    created_at: user.created_at,
  };
}
