import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../config/database";
import type { AuthRequest } from "../middleware/authMiddleware";

interface ResumenFila extends RowDataPacket {
  ingresosMes: string | number;
  gastosMes: string | number;
  cantidadIngresos: number;
  cantidadGastos: number;
}

interface BalanceFila extends RowDataPacket {
  balanceTotal: string | number;
}

interface MovimientoFila extends RowDataPacket {
  id: number;
  descripcion: string;
  monto: string | number;
  tipo: "ingreso" | "gasto";
  fecha: string;
  categoria: string | null;
  color: string | null;
}

interface CategoriaFila extends RowDataPacket {
  categoria: string;
  color: string | null;
  total: string | number;
}

interface SerieFila extends RowDataPacket {
  periodo: string;
  mes: string;
  ingresos: string | number;
  gastos: string | number;
}

function numero(valor: string | number | null | undefined): number {
  const convertido = Number(valor ?? 0);
  return Number.isFinite(convertido) ? convertido : 0;
}

export async function obtenerResumenDashboard(
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
    const [balanceRows] = await pool.query<BalanceFila[]>(
      `
        SELECT
          COALESCE((
            SELECT SUM(cf.saldo_inicial)
            FROM cuentas_financieras cf
            WHERE cf.usuario_id = ?
              AND cf.activa = 1
          ), 0)
          +
          COALESCE((
            SELECT SUM(
              CASE
                WHEN m.tipo = 'ingreso' THEN m.monto
                WHEN m.tipo = 'gasto' THEN -m.monto
                ELSE 0
              END
            )
            FROM movimientos m
            WHERE m.usuario_id = ?
              AND m.estado = 'confirmado'
          ), 0) AS balanceTotal
      `,
      [usuarioId, usuarioId]
    );

    const [resumenRows] = await pool.query<ResumenFila[]>(
      `
        SELECT
          COALESCE(SUM(
            CASE
              WHEN tipo = 'ingreso'
                AND estado = 'confirmado'
                AND YEAR(fecha) = YEAR(CURDATE())
                AND MONTH(fecha) = MONTH(CURDATE())
              THEN monto
              ELSE 0
            END
          ), 0) AS ingresosMes,

          COALESCE(SUM(
            CASE
              WHEN tipo = 'gasto'
                AND estado = 'confirmado'
                AND YEAR(fecha) = YEAR(CURDATE())
                AND MONTH(fecha) = MONTH(CURDATE())
              THEN monto
              ELSE 0
            END
          ), 0) AS gastosMes,

          SUM(
            CASE
              WHEN tipo = 'ingreso'
                AND estado = 'confirmado'
                AND YEAR(fecha) = YEAR(CURDATE())
                AND MONTH(fecha) = MONTH(CURDATE())
              THEN 1
              ELSE 0
            END
          ) AS cantidadIngresos,

          SUM(
            CASE
              WHEN tipo = 'gasto'
                AND estado = 'confirmado'
                AND YEAR(fecha) = YEAR(CURDATE())
                AND MONTH(fecha) = MONTH(CURDATE())
              THEN 1
              ELSE 0
            END
          ) AS cantidadGastos
        FROM movimientos
        WHERE usuario_id = ?
      `,
      [usuarioId]
    );

    const [movimientosRows] = await pool.query<MovimientoFila[]>(
      `
        SELECT
          m.id,
          m.descripcion,
          m.monto,
          m.tipo,
          DATE_FORMAT(m.fecha, '%Y-%m-%d') AS fecha,
          c.nombre AS categoria,
          c.color
        FROM movimientos m
        LEFT JOIN categorias c
          ON c.id = m.categoria_id
        WHERE m.usuario_id = ?
          AND m.estado = 'confirmado'
        ORDER BY m.fecha DESC, m.id DESC
        LIMIT 8
      `,
      [usuarioId]
    );

    const [categoriasRows] = await pool.query<CategoriaFila[]>(
      `
        SELECT
          COALESCE(c.nombre, 'Sin categoría') AS categoria,
          c.color,
          COALESCE(SUM(m.monto), 0) AS total
        FROM movimientos m
        LEFT JOIN categorias c
          ON c.id = m.categoria_id
        WHERE m.usuario_id = ?
          AND m.tipo = 'gasto'
          AND m.estado = 'confirmado'
          AND YEAR(m.fecha) = YEAR(CURDATE())
          AND MONTH(m.fecha) = MONTH(CURDATE())
        GROUP BY c.id, c.nombre, c.color
        ORDER BY total DESC
        LIMIT 5
      `,
      [usuarioId]
    );

    const [serieRows] = await pool.query<SerieFila[]>(
      `
        WITH RECURSIVE meses AS (
          SELECT
            DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01') AS fecha_mes
          UNION ALL
          SELECT DATE_ADD(fecha_mes, INTERVAL 1 MONTH)
          FROM meses
          WHERE fecha_mes < DATE_FORMAT(CURDATE(), '%Y-%m-01')
        )
        SELECT
          DATE_FORMAT(meses.fecha_mes, '%Y-%m') AS periodo,
          ELT(
            MONTH(meses.fecha_mes),
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
          ) AS mes,
          COALESCE(SUM(
            CASE
              WHEN mov.tipo = 'ingreso' AND mov.estado = 'confirmado'
              THEN mov.monto
              ELSE 0
            END
          ), 0) AS ingresos,
          COALESCE(SUM(
            CASE
              WHEN mov.tipo = 'gasto' AND mov.estado = 'confirmado'
              THEN mov.monto
              ELSE 0
            END
          ), 0) AS gastos
        FROM meses
        LEFT JOIN movimientos mov
          ON mov.usuario_id = ?
          AND DATE_FORMAT(mov.fecha, '%Y-%m') = DATE_FORMAT(meses.fecha_mes, '%Y-%m')
        GROUP BY meses.fecha_mes
        ORDER BY meses.fecha_mes
      `,
      [usuarioId]
    );

    const resumen = resumenRows[0];
    const balanceTotal = numero(balanceRows[0]?.balanceTotal);
    const ingresosMes = numero(resumen?.ingresosMes);
    const gastosMes = numero(resumen?.gastosMes);
    const ahorroMes = ingresosMes - gastosMes;
    const porcentajeAhorro =
      ingresosMes > 0 ? Math.round((ahorroMes / ingresosMes) * 100) : 0;

    const totalCategorias = categoriasRows.reduce(
      (acumulado, fila) => acumulado + numero(fila.total),
      0
    );

    res.json({
      ok: true,
      dashboard: {
        resumen: {
          balanceTotal,
          ingresosMes,
          gastosMes,
          ahorroMes,
          porcentajeAhorro,
          cantidadIngresos: Number(resumen?.cantidadIngresos ?? 0),
          cantidadGastos: Number(resumen?.cantidadGastos ?? 0),
        },
        serieMensual: serieRows.map((fila) => ({
          periodo: fila.periodo,
          mes: fila.mes,
          ingresos: numero(fila.ingresos),
          gastos: numero(fila.gastos),
        })),
        gastosPorCategoria: categoriasRows.map((fila) => {
          const total = numero(fila.total);

          return {
            categoria: fila.categoria,
            color: fila.color ?? "#8EB3A4",
            total,
            porcentaje:
              totalCategorias > 0
                ? Math.round((total / totalCategorias) * 100)
                : 0,
          };
        }),
        ultimosMovimientos: movimientosRows.map((fila) => ({
          id: fila.id,
          descripcion: fila.descripcion,
          monto: numero(fila.monto),
          tipo: fila.tipo,
          fecha: fila.fecha,
          categoria: fila.categoria,
          color: fila.color,
        })),
      },
    });
  } catch (error) {
    console.error("Error al obtener el dashboard:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo cargar la información del Dashboard",
    });
  }
}