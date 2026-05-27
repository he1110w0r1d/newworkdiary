import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function checkDatabase() {
  const result = await pool.query<{ ok: number; has_vector: boolean }>(`
    SELECT
      1 AS ok,
      EXISTS (
        SELECT 1
        FROM pg_extension
        WHERE extname = 'vector'
      ) AS has_vector
  `);

  return result.rows[0];
}
