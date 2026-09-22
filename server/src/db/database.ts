import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initializeSchema } from "./schema.ts";

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const database = new DatabaseSync(path, { timeout: 5_000 });
  database.exec("PRAGMA foreign_keys = ON;");
  if (path !== ":memory:") {
    database.exec("PRAGMA journal_mode = WAL;");
  }
  initializeSchema(database);
  return database;
}
