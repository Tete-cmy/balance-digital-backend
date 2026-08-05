import type { Response } from "express";

import type { AuthRequest } from "../middleware/authMiddleware";
import {
  evaluarCierreMensual,
  evaluarMesAnteriorPendiente,
  listarCierresMensuales,
  obtenerVistaPreviaMesActual,
} from "../services/cierreMensualService";

export async function obtenerResumenCierreMensual(
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
    const [vistaPrevia, historial, mesAnterior] =
      await Promise.all([
        obtenerVistaPreviaMesActual(usuarioId),
        listarCierresMensuales(usuarioId),
        evaluarMesAnteriorPendiente(usuarioId),
      ]);

    const historialActualizado =
      mesAnterior.yaEvaluado
        ? historial
        : await listarCierresMensuales(usuarioId);

    res.json({
      ok: true,
      vistaPrevia,
      historial: historialActualizado,
      ultimoCierre: mesAnterior,
    });
  } catch (error) {
    console.error(
      "Error al obtener cierre mensual:",
      error
    );

    res.status(500).json({
      ok: false,
      mensaje:
        error instanceof Error
          ? error.message
          : "No se pudo obtener el cierre mensual",
    });
  }
}

export async function evaluarPeriodoMensual(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const anio = Number(req.body?.anio);
  const mes = Number(req.body?.mes);

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  try {
    const resultado = await evaluarCierreMensual(
      usuarioId,
      anio,
      mes
    );

    res.json({
      ok: true,
      resultado,
    });
  } catch (error) {
    console.error(
      "Error al evaluar periodo mensual:",
      error
    );

    const mensaje =
      error instanceof Error
        ? error.message
        : "No se pudo evaluar el mes";

    res.status(
      mensaje.includes("todavía no termina") ||
      mensaje.includes("inválido")
        ? 400
        : 500
    ).json({
      ok: false,
      mensaje,
    });
  }
}