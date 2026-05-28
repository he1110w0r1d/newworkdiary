import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  const migrationFiles = [
    "001_init.sql",
    "002_seed_demo.sql",
    "003_mission_parent.sql",
    "004_todo_mission.sql",
    "005_admin_feedback.sql",
  ];

  for (const file of migrationFiles) {
    const sqlPath = path.join(__dirname, "sql", file);
    const sql = await readFile(sqlPath, "utf8");
    await pool.query(sql);
    console.log(`Applied ${file}`);
  }
  await pool.end();

  console.log("Database migration completed.");
}

migrate().catch(async (error) => {
  await pool.end().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
