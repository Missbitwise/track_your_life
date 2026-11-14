import "dotenv/config";
import "reflect-metadata";
import { DataSource } from "typeorm";
import * as entities from "../entities/index.js";

export const appDataSource = new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  entities: Object.values(entities),
  migrations: ["src/migrations/*.ts"],
  migrationsTableName: "typeorm_migrations",
  synchronize: false,
  logging: false,
});

export async function connectDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!appDataSource.isInitialized) {
    await appDataSource.initialize();
  }

  await appDataSource.query("SELECT 1");
}

export async function disconnectDatabase(): Promise<void> {
  if (appDataSource.isInitialized) {
    await appDataSource.destroy();
  }
}
