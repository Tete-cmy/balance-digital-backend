import type { Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../config/database";
import type { AuthRequest } from "../middleware/authMiddleware";

interface PresupuestoFila extends RowDataPacket {
  id: number;
  categoria_id: number;
  nombre: string;
  categoria: string;
  color: string | null;
  icono: string | null;
  limite_monto: string | number;
  gastado: string | number;
  mes: number;
  anio: number;
  alerta_porcentaje: number;
  estado: "activo" | "pausado" | "finalizado";
}

interface CategoriaFila extends RowDataPacket {
  id: number;
  nombre: string;
  color: string | null;
  icono: string | null;
}

interface PresupuestoExistenteFila extends RowDataPacket {
  id: number;
}

const categoriasFigma = [
  { nombre: "Alimentación", color: "#48C58D", icono: "🛒" },
  { nombre: "Vivienda", color: "#54866F", icono: "🏠" },
  { nombre: "Transporte", color: "#7A5A54", icono: "🚗" },
  { nombre: "Entretenimiento", color: "#C95749", icono: "🎬" },
  { nombre: "Salud", color: "#1399D6", icono: "💊" },
  { nombre: "Educación", color: "#8B5CF6", icono: "📚" },
] as const;

function numero(valor: string | number | null | undefined): number {
  const convertido = Number(valor ?? 0);
  return Number.isFinite(convertido) ? convertido : 0;
}

async function asegurarCategorias(usuarioId: number): Promise<void> {
  for (const categoria of categoriasFigma) {
    await pool.query(
      `
        INSERT INTO categorias (usuario_id, nombre, tipo, color, icono)
        VALUES (?, ?, 'gasto', ?, ?)
        ON DUPLICATE KEY UPDATE
          tipo = 'gasto',
          color = VALUES(color),
          icono = VALUES(icono)
      `,
      [usuarioId, categoria.nombre, categoria.color, categoria.icono]
    );
  }
}

export async function obtenerPresupuestos(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const ahora = new Date();
  const mes = Number(req.query.mes ?? ahora.getMonth() + 1);
  const anio = Number(req.query.anio ?? ahora.getFullYear());

  if (!usuarioId) {
    res.status(401).json({ ok: false, mensaje: "Usuario no autenticado" });
    return;
  }

  try {
    await asegurarCategorias(usuarioId);

    const [filas] = await pool.query<PresupuestoFila[]>(
      `
        SELECT
          p.id,
          p.categoria_id,
          p.nombre,
          c.nombre AS categoria,
          c.color,
          c.icono,
          p.limite_monto,
          p.mes,
          p.anio,
          p.alerta_porcentaje,
          p.estado,
          COALESCE(SUM(
            CASE
              WHEN m.tipo = 'gasto'
               AND m.estado = 'confirmado'
               AND MONTH(m.fecha) = p.mes
               AND YEAR(m.fecha) = p.anio
              THEN m.monto
              ELSE 0
            END
          ), 0) AS gastado
        FROM presupuestos p
        INNER JOIN categorias c
          ON c.id = p.categoria_id
         AND c.usuario_id = p.usuario_id
        LEFT JOIN movimientos m
          ON m.categoria_id = p.categoria_id
         AND m.usuario_id = p.usuario_id
        WHERE p.usuario_id = ?
          AND p.mes = ?
          AND p.anio = ?
          AND p.estado = 'activo'
        GROUP BY
          p.id,
          p.categoria_id,
          p.nombre,
          c.nombre,
          c.color,
          c.icono,
          p.limite_monto,
          p.mes,
          p.anio,
          p.alerta_porcentaje,
          p.estado
        ORDER BY FIELD(
          c.nombre,
          'Alimentación',
          'Vivienda',
          'Transporte',
          'Entretenimiento',
          'Salud',
          'Educación'
        )
      `,
      [usuarioId, mes, anio]
    );

    const presupuestos = filas.map((fila) => {
      const limite = numero(fila.limite_monto);
      const gastado = numero(fila.gastado);
      const porcentaje = limite > 0 ? (gastado / limite) * 100 : 0;

      return {
        id: fila.id,
        categoriaId: fila.categoria_id,
        nombre: fila.nombre,
        categoria: fila.categoria,
        color: fila.color ?? "#48C58D",
        icono: fila.icono ?? "💰",
        limite,
        gastado,
        disponible: limite - gastado,
        porcentaje,
        excedido: gastado > limite,
        excedidoPor: Math.max(gastado - limite, 0),
        mes: fila.mes,
        anio: fila.anio,
        alertaPorcentaje: fila.alerta_porcentaje,
        estado: fila.estado,
      };
    });

    const totalLimite = presupuestos.reduce(
      (total, presupuesto) => total + presupuesto.limite,
      0
    );

    const totalGastado = presupuestos.reduce(
      (total, presupuesto) => total + presupuesto.gastado,
      0
    );

    res.json({
      ok: true,
      mes,
      anio,
      resumen: {
        totalLimite,
        totalGastado,
        disponible: totalLimite - totalGastado,
        porcentaje: totalLimite > 0 ? (totalGastado / totalLimite) * 100 : 0,
      },
      presupuestos,
    });
  } catch (error) {
    console.error("Error al obtener presupuestos:", error);
    res.status(500).json({
      ok: false,
      mensaje: "No se pudieron cargar los presupuestos",
    });
  }
}

export async function obtenerCategoriasPresupuesto(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;

  if (!usuarioId) {
    res.status(401).json({ ok: false, mensaje: "Usuario no autenticado" });
    return;
  }

  try {
    await asegurarCategorias(usuarioId);

    const [categorias] = await pool.query<CategoriaFila[]>(
      `
        SELECT id, nombre, color, icono
        FROM categorias
        WHERE usuario_id = ?
          AND nombre IN (
            'Alimentación',
            'Vivienda',
            'Transporte',
            'Entretenimiento',
            'Salud',
            'Educación'
          )
        ORDER BY FIELD(
          nombre,
          'Alimentación',
          'Vivienda',
          'Transporte',
          'Entretenimiento',
          'Salud',
          'Educación'
        )
      `,
      [usuarioId]
    );

    res.json({ ok: true, categorias });
  } catch (error) {
    console.error("Error al obtener categorías:", error);
    res.status(500).json({
      ok: false,
      mensaje: "No se pudieron cargar las categorías",
    });
  }
}

export async function guardarPresupuesto(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const {
    categoriaNombre,
    limiteMonto,
    mes,
    anio,
    alertaPorcentaje = 80,
  } = req.body ?? {};

  if (!usuarioId) {
    res.status(401).json({ ok: false, mensaje: "Usuario no autenticado" });
    return;
  }

  const categoriaValida = categoriasFigma.find(
    (categoria) => categoria.nombre === String(categoriaNombre ?? "").trim()
  );

  if (!categoriaValida) {
    res.status(400).json({
      ok: false,
      mensaje: "Selecciona una categoría válida",
    });
    return;
  }

  const limiteNumero = Number(limiteMonto);
  const mesNumero = Number(mes);
  const anioNumero = Number(anio);
  const alertaNumero = Number(alertaPorcentaje);

  if (!Number.isFinite(limiteNumero) || limiteNumero <= 0) {
    res.status(400).json({
      ok: false,
      mensaje: "El límite debe ser mayor a cero",
    });
    return;
  }

  try {
    await asegurarCategorias(usuarioId);

    const [categorias] = await pool.query<CategoriaFila[]>(
      `
        SELECT id, nombre, color, icono
        FROM categorias
        WHERE usuario_id = ?
          AND nombre = ?
        LIMIT 1
      `,
      [usuarioId, categoriaValida.nombre]
    );

    const categoria = categorias[0];

    if (!categoria) {
      res.status(500).json({
        ok: false,
        mensaje: "No se pudo preparar la categoría",
      });
      return;
    }

    const [existentes] = await pool.query<PresupuestoExistenteFila[]>(
      `
        SELECT id
        FROM presupuestos
        WHERE usuario_id = ?
          AND categoria_id = ?
          AND mes = ?
          AND anio = ?
        LIMIT 1
      `,
      [usuarioId, categoria.id, mesNumero, anioNumero]
    );

    const existente = existentes[0];
    const nombrePresupuesto = `Presupuesto de ${categoria.nombre.toLowerCase()}`;

    if (existente) {
      await pool.query<ResultSetHeader>(
        `
          UPDATE presupuestos
          SET
            nombre = ?,
            limite_monto = ?,
            alerta_porcentaje = ?,
            estado = 'activo'
          WHERE id = ?
            AND usuario_id = ?
        `,
        [
          nombrePresupuesto,
          limiteNumero,
          alertaNumero,
          existente.id,
          usuarioId,
        ]
      );

      res.json({
        ok: true,
        mensaje: "Presupuesto actualizado correctamente",
      });
      return;
    }

    const [resultado] = await pool.query<ResultSetHeader>(
      `
        INSERT INTO presupuestos (
          usuario_id,
          categoria_id,
          nombre,
          limite_monto,
          mes,
          anio,
          alerta_porcentaje,
          estado
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'activo')
      `,
      [
        usuarioId,
        categoria.id,
        nombrePresupuesto,
        limiteNumero,
        mesNumero,
        anioNumero,
        alertaNumero,
      ]
    );

    res.status(201).json({
      ok: true,
      mensaje: "Presupuesto creado correctamente",
      presupuestoId: resultado.insertId,
    });
  } catch (error) {
    console.error("Error al guardar presupuesto:", error);
    res.status(500).json({
      ok: false,
      mensaje: "No se pudo guardar el presupuesto",
    });
  }
}

export async function eliminarPresupuesto(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const presupuestoId = Number(req.params.id);

  if (!usuarioId) {
    res.status(401).json({ ok: false, mensaje: "Usuario no autenticado" });
    return;
  }

  try {
    const [resultado] = await pool.query<ResultSetHeader>(
      `
        DELETE FROM presupuestos
        WHERE id = ? AND usuario_id = ?
      `,
      [presupuestoId, usuarioId]
    );

    if (resultado.affectedRows === 0) {
      res.status(404).json({
        ok: false,
        mensaje: "Presupuesto no encontrado",
      });
      return;
    }

    res.json({
      ok: true,
      mensaje: "Presupuesto eliminado correctamente",
    });
  } catch (error) {
    console.error("Error al eliminar presupuesto:", error);
    res.status(500).json({
      ok: false,
      mensaje: "No se pudo eliminar el presupuesto",
    });
  }
}