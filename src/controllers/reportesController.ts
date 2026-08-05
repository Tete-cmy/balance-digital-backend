import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../config/database";
import type { AuthRequest } from "../middleware/authMiddleware";

interface ResumenFila extends RowDataPacket {
  ingresos: string | number;
  gastos: string | number;
}

interface MesFila extends RowDataPacket {
  clave: string;
  mes: string;
  ingresos: string | number;
  gastos: string | number;
}

interface CategoriaFila extends RowDataPacket {
  categoria: string;
  color: string | null;
  monto: string | number;
}

function numero(valor: string | number | null | undefined): number {
  const convertido = Number(valor ?? 0);
  return Number.isFinite(convertido) ? convertido : 0;
}

export async function obtenerReportes(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  try {
    const [resumenFilas] = await pool.query<ResumenFila[]>(
      `
        SELECT
          COALESCE(SUM(
            CASE
              WHEN tipo = 'ingreso'
               AND estado = 'confirmado'
               AND fecha >= DATE_FORMAT(
                 DATE_SUB(CURDATE(), INTERVAL 5 MONTH),
                 '%Y-%m-01'
               )
              THEN monto
              ELSE 0
            END
          ), 0) AS ingresos,
          COALESCE(SUM(
            CASE
              WHEN tipo = 'gasto'
               AND estado = 'confirmado'
               AND fecha >= DATE_FORMAT(
                 DATE_SUB(CURDATE(), INTERVAL 5 MONTH),
                 '%Y-%m-01'
               )
              THEN monto
              ELSE 0
            END
          ), 0) AS gastos
        FROM movimientos
        WHERE usuario_id = ?
      `,
      [usuarioId]
    );

    const [mesesFilas] = await pool.query<MesFila[]>(
      `
        WITH RECURSIVE meses AS (
          SELECT
            DATE_FORMAT(
              DATE_SUB(CURDATE(), INTERVAL 5 MONTH),
              '%Y-%m-01'
            ) AS inicio_mes,
            1 AS posicion

          UNION ALL

          SELECT
            DATE_ADD(inicio_mes, INTERVAL 1 MONTH),
            posicion + 1
          FROM meses
          WHERE posicion < 6
        )
        SELECT
          DATE_FORMAT(meses.inicio_mes, '%Y-%m') AS clave,
          ELT(
            MONTH(meses.inicio_mes),
            'Enero',
            'Febrero',
            'Marzo',
            'Abril',
            'Mayo',
            'Junio',
            'Julio',
            'Agosto',
            'Septiembre',
            'Octubre',
            'Noviembre',
            'Diciembre'
          ) AS mes,
          COALESCE(SUM(
            CASE
              WHEN mv.tipo = 'ingreso'
               AND mv.estado = 'confirmado'
              THEN mv.monto
              ELSE 0
            END
          ), 0) AS ingresos,
          COALESCE(SUM(
            CASE
              WHEN mv.tipo = 'gasto'
               AND mv.estado = 'confirmado'
              THEN mv.monto
              ELSE 0
            END
          ), 0) AS gastos
        FROM meses
        LEFT JOIN movimientos mv
          ON mv.usuario_id = ?
         AND mv.fecha >= meses.inicio_mes
         AND mv.fecha < DATE_ADD(meses.inicio_mes, INTERVAL 1 MONTH)
        GROUP BY
          meses.inicio_mes,
          posicion
        ORDER BY posicion
      `,
      [usuarioId]
    );

    const [categoriasFilas] = await pool.query<CategoriaFila[]>(
      `
        SELECT
          COALESCE(c.nombre, 'Sin categoría') AS categoria,
          COALESCE(c.color, '#8FA49B') AS color,
          COALESCE(SUM(m.monto), 0) AS monto
        FROM movimientos m
        LEFT JOIN categorias c
          ON c.id = m.categoria_id
         AND c.usuario_id = m.usuario_id
        WHERE m.usuario_id = ?
          AND m.tipo = 'gasto'
          AND m.estado = 'confirmado'
          AND YEAR(m.fecha) = YEAR(CURDATE())
          AND MONTH(m.fecha) = MONTH(CURDATE())
        GROUP BY
          COALESCE(c.nombre, 'Sin categoría'),
          COALESCE(c.color, '#8FA49B')
        HAVING SUM(m.monto) > 0
        ORDER BY monto DESC
      `,
      [usuarioId]
    );

    const ingresos6m = numero(resumenFilas[0]?.ingresos);
    const gastos6m = numero(resumenFilas[0]?.gastos);
    const ahorro6m = ingresos6m - gastos6m;
    const tasaAhorro =
      ingresos6m > 0 ? (ahorro6m / ingresos6m) * 100 : 0;

    const meses = mesesFilas.map((fila) => {
      const ingresos = numero(fila.ingresos);
      const gastos = numero(fila.gastos);

      return {
        clave: fila.clave,
        mes: fila.mes,
        ingresos,
        gastos,
        ahorro: ingresos - gastos,
      };
    });

    const totalCategorias = categoriasFilas.reduce(
      (total, fila) => total + numero(fila.monto),
      0
    );

    const categorias = categoriasFilas.map((fila) => {
      const monto = numero(fila.monto);

      return {
        nombre: fila.categoria,
        color: fila.color ?? "#8FA49B",
        monto,
        porcentaje:
          totalCategorias > 0 ? (monto / totalCategorias) * 100 : 0,
      };
    });

    res.json({
      ok: true,
      resumen: {
        ingresos6m,
        gastos6m,
        ahorro6m,
        tasaAhorro,
      },
      meses,
      categorias,
    });
  } catch (error) {
    console.error("Error al obtener reportes:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudieron cargar los reportes",
    });
  }
}