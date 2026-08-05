import type { Response } from "express";
import type {
  ResultSetHeader,
  RowDataPacket,
} from "mysql2";

import { pool } from "../config/database";
import type { AuthRequest } from "../middleware/authMiddleware";

type TipoNotificacion =
  | "ingreso"
  | "gasto"
  | "presupuesto"
  | "meta"
  | "racha"
  | "logro"
  | "recordatorio"
  | "consejo"
  | "sistema";

interface NotificacionFila extends RowDataPacket {
  id: number;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  entidad_tipo: string | null;
  entidad_id: number | null;
  leida: 0 | 1;
  fecha_lectura: string | Date | null;
  creada_en: string | Date;
}

interface ConteoFila extends RowDataPacket {
  total: number;
}

function fechaIso(
  valor: string | Date | null
): string | null {
  if (!valor) {
    return null;
  }

  return valor instanceof Date
    ? valor.toISOString()
    : new Date(valor).toISOString();
}

async function asegurarNotificacionBienvenida(
  usuarioId: number
): Promise<void> {
  const [conteo] = await pool.query<ConteoFila[]>(
    `
      SELECT COUNT(*) AS total
      FROM notificaciones
      WHERE usuario_id = ?
    `,
    [usuarioId]
  );

  if (Number(conteo[0]?.total ?? 0) > 0) {
    return;
  }

  await pool.query<ResultSetHeader>(
    `
      INSERT INTO notificaciones (
        usuario_id,
        tipo,
        titulo,
        mensaje,
        entidad_tipo,
        entidad_id
      )
      VALUES (
        ?,
        'sistema',
        'Bienvenido a tu centro de notificaciones',
        'Aquí recibirás avisos sobre presupuestos, metas, logros, rachas y actividad importante de Balance Digital.',
        'sistema',
        NULL
      )
    `,
    [usuarioId]
  );
}

export async function listarNotificaciones(
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

  const filtro =
    req.query.filtro === "no_leidas" ||
    req.query.filtro === "leidas"
      ? req.query.filtro
      : "todas";

  try {
    await asegurarNotificacionBienvenida(usuarioId);

    const condiciones = ["usuario_id = ?"];
    const parametros: Array<number | string> = [
      usuarioId,
    ];

    if (filtro === "no_leidas") {
      condiciones.push("leida = 0");
    }

    if (filtro === "leidas") {
      condiciones.push("leida = 1");
    }

    const [filas] =
      await pool.query<NotificacionFila[]>(
        `
          SELECT
            id,
            tipo,
            titulo,
            mensaje,
            entidad_tipo,
            entidad_id,
            leida,
            fecha_lectura,
            creada_en
          FROM notificaciones
          WHERE ${condiciones.join(" AND ")}
          ORDER BY creada_en DESC, id DESC
          LIMIT 100
        `,
        parametros
      );

    const [conteos] =
      await pool.query<RowDataPacket[]>(
        `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN leida = 0 THEN 1 ELSE 0 END)
              AS no_leidas,
            SUM(CASE WHEN leida = 1 THEN 1 ELSE 0 END)
              AS leidas
          FROM notificaciones
          WHERE usuario_id = ?
        `,
        [usuarioId]
      );

    const resumen = conteos[0] ?? {};

    res.json({
      ok: true,
      notificaciones: filas.map((fila) => ({
        id: fila.id,
        tipo: fila.tipo,
        titulo: fila.titulo,
        mensaje: fila.mensaje,
        entidadTipo: fila.entidad_tipo,
        entidadId: fila.entidad_id,
        leida: Boolean(fila.leida),
        fechaLectura: fechaIso(
          fila.fecha_lectura
        ),
        creadaEn: fechaIso(fila.creada_en),
      })),
      resumen: {
        total: Number(resumen.total ?? 0),
        noLeidas: Number(
          resumen.no_leidas ?? 0
        ),
        leidas: Number(resumen.leidas ?? 0),
      },
    });
  } catch (error) {
    console.error(
      "Error al listar notificaciones:",
      error
    );

    res.status(500).json({
      ok: false,
      mensaje:
        "No se pudieron cargar las notificaciones",
    });
  }
}

export async function obtenerConteoNoLeidas(
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
    await asegurarNotificacionBienvenida(usuarioId);

    const [filas] = await pool.query<ConteoFila[]>(
      `
        SELECT COUNT(*) AS total
        FROM notificaciones
        WHERE usuario_id = ?
          AND leida = 0
      `,
      [usuarioId]
    );

    res.json({
      ok: true,
      noLeidas: Number(filas[0]?.total ?? 0),
    });
  } catch (error) {
    console.error(
      "Error al contar notificaciones:",
      error
    );

    res.status(500).json({
      ok: false,
      mensaje:
        "No se pudo obtener el contador de notificaciones",
    });
  }
}

export async function marcarNotificacionLeida(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const notificacionId = Number(req.params.id);

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  if (
    !Number.isInteger(notificacionId) ||
    notificacionId <= 0
  ) {
    res.status(400).json({
      ok: false,
      mensaje: "Notificación inválida",
    });
    return;
  }

  try {
    const [resultado] =
      await pool.query<ResultSetHeader>(
        `
          UPDATE notificaciones
          SET
            leida = 1,
            fecha_lectura = COALESCE(
              fecha_lectura,
              CURRENT_TIMESTAMP
            )
          WHERE id = ?
            AND usuario_id = ?
        `,
        [notificacionId, usuarioId]
      );

    if (resultado.affectedRows === 0) {
      res.status(404).json({
        ok: false,
        mensaje: "Notificación no encontrada",
      });
      return;
    }

    res.json({
      ok: true,
      mensaje: "Notificación marcada como leída",
    });
  } catch (error) {
    console.error(
      "Error al marcar notificación:",
      error
    );

    res.status(500).json({
      ok: false,
      mensaje:
        "No se pudo actualizar la notificación",
    });
  }
}

export async function marcarTodasLeidas(
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
    const [resultado] =
      await pool.query<ResultSetHeader>(
        `
          UPDATE notificaciones
          SET
            leida = 1,
            fecha_lectura = COALESCE(
              fecha_lectura,
              CURRENT_TIMESTAMP
            )
          WHERE usuario_id = ?
            AND leida = 0
        `,
        [usuarioId]
      );

    res.json({
      ok: true,
      mensaje:
        "Todas las notificaciones fueron marcadas como leídas",
      actualizadas: resultado.affectedRows,
    });
  } catch (error) {
    console.error(
      "Error al marcar todas como leídas:",
      error
    );

    res.status(500).json({
      ok: false,
      mensaje:
        "No se pudieron actualizar las notificaciones",
    });
  }
}

export async function eliminarNotificacion(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const notificacionId = Number(req.params.id);

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  if (
    !Number.isInteger(notificacionId) ||
    notificacionId <= 0
  ) {
    res.status(400).json({
      ok: false,
      mensaje: "Notificación inválida",
    });
    return;
  }

  try {
    const [resultado] =
      await pool.query<ResultSetHeader>(
        `
          DELETE FROM notificaciones
          WHERE id = ?
            AND usuario_id = ?
        `,
        [notificacionId, usuarioId]
      );

    if (resultado.affectedRows === 0) {
      res.status(404).json({
        ok: false,
        mensaje: "Notificación no encontrada",
      });
      return;
    }

    res.json({
      ok: true,
      mensaje: "Notificación eliminada",
    });
  } catch (error) {
    console.error(
      "Error al eliminar notificación:",
      error
    );

    res.status(500).json({
      ok: false,
      mensaje:
        "No se pudo eliminar la notificación",
    });
  }
}