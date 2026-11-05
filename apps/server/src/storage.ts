import Database from "better-sqlite3";
import { migrateProject, type Project } from "@twynix/shared-types";
export class ProjectStore {
  private db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, definition TEXT NOT NULL, updated TEXT NOT NULL)",
    );
  }
  list(): { id: string; name: string; updated: string }[] {
    return this.db
      .prepare("SELECT id,name,updated FROM projects ORDER BY updated DESC")
      .all() as { id: string; name: string; updated: string }[];
  }
  save(p: Project): void {
    this.db
      .prepare(
        "INSERT INTO projects VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, definition=excluded.definition, updated=excluded.updated",
      )
      .run(p.id, p.name, JSON.stringify(p), new Date().toISOString());
  }
  get(id: string): Project {
    const row = this.db
      .prepare("SELECT definition FROM projects WHERE id=?")
      .get(id) as { definition: string } | undefined;
    if (!row) throw Error("Project not found");
    return migrateProject(JSON.parse(row.definition));
  }
  delete(id: string): void {
    this.db.prepare("DELETE FROM projects WHERE id=?").run(id);
  }
  close(): void {
    this.db.close();
  }
}
