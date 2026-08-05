
import type { Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../config/database";
import type { AuthRequest } from "../middleware/authMiddleware";

type TipoMovimiento = "ingreso" | "gasto";
type EstadoMovimiento = "pendiente" | "confirmado" | "cancelado";

interface MovimientoFila extends RowDataPacket {
  id: number;
  descripcion: string;
  monto: string | number;
  tipo: TipoMovimiento;
  fecha: string;
  metodo_pago: string;
  estado: EstadoMovimiento;
  notas: string | null;
  categoria_id: number | null;
  categoria: string | null;
  categoria_color: string | null;
}

interface CategoriaFila extends RowDataPacket {
  id: number;
  nombre: string;
  tipo: "ingreso" | "gasto" | "ambos";
  color: string;
}

interface ResumenFila extends RowDataPacket {
  totalIngresos: string | number;
  totalGastos: string | number;
  cantidadIngresos: number;
  cantidadGastos: number;
}

const categoriasIniciales = [
  { nombre: "Alimentación", tipo: "ambos", color: "#48C58D" },
  { nombre: "Entretenimiento", tipo: "ambos", color: "#B867F4" },
  { nombre: "Transporte", tipo: "ambos", color: "#F59E0B" },
  { nombre: "Vivienda", tipo: "ambos", color: "#6C8CFF" },
  { nombre: "Salud", tipo: "ambos", color: "#8EB3A4" },
  { nombre: "Nómina", tipo: "ambos", color: "#31BF7D" },
  { nombre: "Freelance", tipo: "ambos", color: "#2FA56F" },
  { nombre: "Inversión", tipo: "ambos", color: "#5B8DEF" },
] as const;

function numero(valor: string | number | null | undefined): number {
  const convertido = Number(valor ?? 0);
  return Number.isFinite(convertido) ? convertido : 0;
}

async function asegurarCategorias(usuarioId: number): Promise<void> {
  for (const categoria of categoriasIniciales) {
    await pool.query(
      `
        INSERT INTO categorias (usuario_id, nombre, tipo, color)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          tipo = VALUES(tipo),
          color = VALUES(color)
      `,
      [usuarioId, categoria.nombre, categoria.tipo, categoria.color]
    );
  }
}

export async function obtenerCategorias(
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

    const [filas] = await pool.query<CategoriaFila[]>(
      `
        SELECT id, nombre, tipo, color
        FROM categorias
        WHERE usuario_id = ?
          AND nombre IN (
            'Alimentación',
            'Entretenimiento',
            'Transporte',
            'Vivienda',
            'Salud',
            'Nómina',
            'Freelance',
            'Inversión'
          )
        ORDER BY FIELD(
          nombre,
          'Alimentación',
          'Entretenimiento',
          'Transporte',
          'Vivienda',
          'Salud',
          'Nómina',
          'Freelance',
          'Inversión'
        )
      `,
      [usuarioId]
    );

    res.json({ ok: true, categorias: filas });
  } catch (error) {
    console.error("Error al obtener categorías:", error);
    res.status(500).json({
      ok: false,
      mensaje: "No se pudieron cargar las categorías",
    });
  }
}

export async function listarMovimientos(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;

  if (!usuarioId) {
    res.status(401).json({ ok: false, mensaje: "Usuario no autenticado" });
    return;
  }

  const busqueda =
    typeof req.query.busqueda === "string" ? req.query.busqueda.trim() : "";

  const tipo =
    req.query.tipo === "ingreso" || req.query.tipo === "gasto"
      ? req.query.tipo
      : "";

  const estado =
    req.query.estado === "pendiente" ||
    req.query.estado === "confirmado" ||
    req.query.estado === "cancelado"
      ? req.query.estado
      : "";

  try {
    await asegurarCategorias(usuarioId);

    const condiciones = ["m.usuario_id = ?"];
    const parametros: Array<string | number> = [usuarioId];

    if (busqueda) {
      condiciones.push("(m.descripcion LIKE ? OR c.nombre LIKE ?)");
      parametros.push(`%${busqueda}%`, `%${busqueda}%`);
    }

    if (tipo) {
      condiciones.push("m.tipo = ?");
      parametros.push(tipo);
    }

    if (estado) {
      condiciones.push("m.estado = ?");
      parametros.push(estado);
    }

    const [filas] = await pool.query<MovimientoFila[]>(
      `
        SELECT
          m.id,
          m.descripcion,
          m.monto,
          m.tipo,
          DATE_FORMAT(m.fecha, '%Y-%m-%d') AS fecha,
          m.metodo_pago,
          m.estado,
          m.notas,
          m.categoria_id,
          c.nombre AS categoria,
          c.color AS categoria_color
        FROM movimientos m
        LEFT JOIN categorias c ON c.id = m.categoria_id
        WHERE ${condiciones.join(" AND ")}
        ORDER BY m.fecha DESC, m.id DESC
        LIMIT 300
      `,
      parametros
    );

    const [resumenRows] = await pool.query<ResumenFila[]>(
      `
        SELECT
          COALESCE(SUM(CASE
            WHEN tipo = 'ingreso' AND estado = 'confirmado' THEN monto
            ELSE 0
          END), 0) AS totalIngresos,
          COALESCE(SUM(CASE
            WHEN tipo = 'gasto' AND estado = 'confirmado' THEN monto
            ELSE 0
          END), 0) AS totalGastos,
          SUM(CASE
            WHEN tipo = 'ingreso' AND estado = 'confirmado' THEN 1
            ELSE 0
          END) AS cantidadIngresos,
          SUM(CASE
            WHEN tipo = 'gasto' AND estado = 'confirmado' THEN 1
            ELSE 0
          END) AS cantidadGastos
        FROM movimientos
        WHERE usuario_id = ?
      `,
      [usuarioId]
    );

    const resumen = resumenRows[0];
    const totalIngresos = numero(resumen?.totalIngresos);
    const totalGastos = numero(resumen?.totalGastos);
    const cantidadIngresos = Number(resumen?.cantidadIngresos ?? 0);
    const cantidadGastos = Number(resumen?.cantidadGastos ?? 0);

    res.json({
      ok: true,
      movimientos: filas.map((fila) => ({
        ...fila,
        monto: numero(fila.monto),
      })),
      resumen: {
        totalIngresos,
        totalGastos,
        balanceNeto: totalIngresos - totalGastos,
        cantidadIngresos,
        cantidadGastos,
        cantidadTotal: cantidadIngresos + cantidadGastos,
      },
    });
  } catch (error) {
    console.error("Error al listar movimientos:", error);
    res.status(500).json({
      ok: false,
      mensaje: "No se pudieron cargar los movimientos",
    });
  }
}

export async function crearMovimiento(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;

  if (!usuarioId) {
    res.status(401).json({ ok: false, mensaje: "Usuario no autenticado" });
    return;
  }

  const {
    tipo,
    descripcion,
    monto,
    categoriaId,
    estado = "confirmado",
  } = req.body ?? {};

  if (tipo !== "ingreso" && tipo !== "gasto") {
    res.status(400).json({ ok: false, mensaje: "Tipo de movimiento inválido" });
    return;
  }

  if (estado !== "confirmado" && estado !== "pendiente") {
    res.status(400).json({ ok: false, mensaje: "Estado inválido" });
    return;
  }

  if (typeof descripcion !== "string" || !descripcion.trim()) {
    res.status(400).json({ ok: false, mensaje: "La descripción es obligatoria" });
    return;
  }

  const montoNumero = Number(monto);

  if (!Number.isFinite(montoNumero) || montoNumero <= 0) {
    res.status(400).json({ ok: false, mensaje: "El monto debe ser mayor a cero" });
    return;
  }

  try {
    await asegurarCategorias(usuarioId);

    const [categorias] = await pool.query<CategoriaFila[]>(
      `
        SELECT id, nombre, tipo, color
        FROM categorias
        WHERE id = ? AND usuario_id = ?
        LIMIT 1
      `,
      [Number(categoriaId), usuarioId]
    );

    const categoria = categorias[0];

    if (!categoria) {
      res.status(400).json({
        ok: false,
        mensaje: "La categoría seleccionada no existe",
      });
      return;
    }

    const [resultado] = await pool.query<ResultSetHeader>(
      `
        INSERT INTO movimientos (
          usuario_id,
          cuenta_id,
          categoria_id,
          tipo,
          descripcion,
          monto,
          fecha,
          metodo_pago,
          estado,
          notas,
          comprobante_url,
          es_recurrente
        )
        VALUES (?, NULL, ?, ?, ?, ?, CURDATE(), 'efectivo', ?, NULL, NULL, 0)
      `,
      [
        usuarioId,
        categoria.id,
        tipo,
        descripcion.trim(),
        montoNumero,
        estado,
      ]
    );

    res.status(201).json({
      ok: true,
      mensaje: "Movimiento registrado correctamente",
      movimientoId: resultado.insertId,
    });
  } catch (error) {
    console.error("Error al crear movimiento:", error);
    res.status(500).json({
      ok: false,
      mensaje: "No se pudo registrar el movimiento",
    });
  }
}

export async function cambiarEstadoMovimiento(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const movimientoId = Number(req.params.id);
  const { estado } = req.body ?? {};

  if (!usuarioId) {
    res.status(401).json({ ok: false, mensaje: "Usuario no autenticado" });
    return;
  }

  if (!Number.isInteger(movimientoId) || movimientoId <= 0) {
    res.status(400).json({ ok: false, mensaje: "Movimiento inválido" });
    return;
  }

  if (
    estado !== "pendiente" &&
    estado !== "confirmado" &&
    estado !== "cancelado"
  ) {
    res.status(400).json({ ok: false, mensaje: "Estado inválido" });
    return;
  }

  try {
    const [resultado] = await pool.query<ResultSetHeader>(
      `
        UPDATE movimientos
        SET estado = ?
        WHERE id = ? AND usuario_id = ?
      `,
      [estado, movimientoId, usuarioId]
    );

    if (resultado.affectedRows === 0) {
      res.status(404).json({ ok: false, mensaje: "Movimiento no encontrado" });
      return;
    }

    res.json({ ok: true, mensaje: "Estado actualizado correctamente" });
  } catch (error) {
    console.error("Error al cambiar estado:", error);
    res.status(500).json({
      ok: false,
      mensaje: "No se pudo actualizar el movimiento",
    });
  }
}

export async function eliminarMovimiento(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const movimientoId = Number(req.params.id);

  if (!usuarioId) {
    res.status(401).json({ ok: false, mensaje: "Usuario no autenticado" });
    return;
  }

  if (!Number.isInteger(movimientoId) || movimientoId <= 0) {
    res.status(400).json({ ok: false, mensaje: "Movimiento inválido" });
    return;
  }

  try {
    const [resultado] = await pool.query<ResultSetHeader>(
      `
        DELETE FROM movimientos
        WHERE id = ? AND usuario_id = ?
      `,
      [movimientoId, usuarioId]
    );

    if (resultado.affectedRows === 0) {
      res.status(404).json({ ok: false, mensaje: "Movimiento no encontrado" });
      return;
    }

    res.json({ ok: true, mensaje: "Movimiento eliminado correctamente" });
  } catch (error) {
    console.error("Error al eliminar movimiento:", error);
    res.status(500).json({
      ok: false,
      mensaje: "No se pudo eliminar el movimiento",
    });
  }
}