import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

export const pool = mysql.createPool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME ?? "balance_digital",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function probarConexion(): Promise<void> {
  const connection = await pool.getConnection();

  try {
    await connection.query("SELECT 1");
    console.log("✅ Conexión con MySQL establecida");
  } finally {
    connection.release();
  }
}
