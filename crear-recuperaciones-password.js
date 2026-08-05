require("dotenv").config();
const mysql = require("mysql2/promise");

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [info] = await connection.query(`
    SELECT
      DATABASE() AS base_actual,
      @@hostname AS servidor,
      @@port AS puerto
  `);

  console.log("Conexión usada por el script:", info[0]);

  await connection.query(`
    CREATE TABLE IF NOT EXISTS recuperaciones_password (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      usuario_id INT UNSIGNED NOT NULL,
      codigo_hash VARCHAR(255) NOT NULL,
      expira_en DATETIME NOT NULL,
      intentos TINYINT UNSIGNED NOT NULL DEFAULT 0,
      utilizado TINYINT(1) NOT NULL DEFAULT 0,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

      INDEX idx_recuperacion_usuario (usuario_id),
      INDEX idx_recuperacion_expira (expira_en),

      CONSTRAINT fk_recuperacion_usuario
        FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id)
        ON DELETE CASCADE
    )
  `);

  const [tables] = await connection.query(
    "SHOW TABLES LIKE 'recuperaciones_password'"
  );

  console.log("Tabla encontrada:", tables);

  await connection.end();
}

main().catch((error) => {
  console.error(
    "No se pudo crear o verificar la tabla:",
    error
  );

  process.exit(1);
});