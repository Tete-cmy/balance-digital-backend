import type { Response } from "express";

import type { AuthRequest } from "../middleware/authMiddleware";
import {
  cambiarNombreMascota,
  desbloquearApariencia,
  equiparApariencia,
  obtenerResumenGamificacion,
  registrarEventoGamificacion,
} from "../services/gamificacionService";
import type {
  RegistrarEventoGamificacion,
  TipoEventoGamificacion,
} from "../types/gamificacion";

const TIPOS_EVENTO_VALIDOS =
  new Set<TipoEventoGamificacion>([
    "INICIO_SESION",
    "PERFIL_COMPLETADO",
    "INGRESO_REGISTRADO",
    "GASTO_REGISTRADO",
    "PRESUPUESTO_CREADO",
    "PRESUPUESTO_ACTUALIZADO",
    "META_CREADA",
    "APORTE_META",
    "REPORTE_CONSULTADO",
    "OTRO",
  ]);

function obtenerUsuarioId(
  req: AuthRequest,
  res: Response
): number | null {
  const usuarioId = req.usuario?.id;

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return null;
  }

  return usuarioId;
}

function mensajeError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado";
}

export async function obtenerGamificacion(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = obtenerUsuarioId(req, res);
  if (!usuarioId) return;

  try {
    const resumen =
      await obtenerResumenGamificacion(usuarioId);

    res.json({
      ok: true,
      resumen,
    });
  } catch (error) {
    console.error(
      "Error al obtener gamificación:",
      error
    );

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo cargar Flamma",
    });
  }
}

export async function registrarEvento(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = obtenerUsuarioId(req, res);
  if (!usuarioId) return;

  const tipoEvento = String(
    req.body?.tipoEvento ?? ""
  ) as TipoEventoGamificacion;

  if (!TIPOS_EVENTO_VALIDOS.has(tipoEvento)) {
    res.status(400).json({
      ok: false,
      mensaje: "El tipo de evento no es válido",
    });
    return;
  }

  const referenciaId =
    req.body?.referenciaId === undefined ||
    req.body?.referenciaId === null
      ? null
      : Number(req.body.referenciaId);

  if (
    referenciaId !== null &&
    (!Number.isInteger(referenciaId) ||
      referenciaId <= 0)
  ) {
    res.status(400).json({
      ok: false,
      mensaje: "La referencia del evento no es válida",
    });
    return;
  }

  const evento: RegistrarEventoGamificacion = {
    tipoEvento,
    referenciaId,
    descripcion:
      req.body?.descripcion === undefined
        ? null
        : String(req.body.descripcion),
  };

  try {
    const resultado =
      await registrarEventoGamificacion(
        usuarioId,
        evento
      );

    const resumen =
      await obtenerResumenGamificacion(usuarioId);

    res.status(
      resultado.registrado ? 201 : 200
    ).json({
      ok: true,
      mensaje: resultado.registrado
        ? "Actividad registrada"
        : "La actividad ya había sido registrada",
      resultado,
      resumen,
    });
  } catch (error) {
    console.error(
      "Error al registrar evento de gamificación:",
      error
    );

    res.status(500).json({
      ok: false,
      mensaje: mensajeError(error),
    });
  }
}

export async function actualizarNombreMascota(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = obtenerUsuarioId(req, res);
  if (!usuarioId) return;

  const nombre = String(req.body?.nombre ?? "");

  try {
    await cambiarNombreMascota(
      usuarioId,
      nombre
    );

    const resumen =
      await obtenerResumenGamificacion(usuarioId);

    res.json({
      ok: true,
      mensaje: "Nombre actualizado",
      resumen,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      mensaje: mensajeError(error),
    });
  }
}

export async function comprarApariencia(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = obtenerUsuarioId(req, res);
  if (!usuarioId) return;

  const aparienciaId = Number(
    req.params.aparienciaId
  );

  if (
    !Number.isInteger(aparienciaId) ||
    aparienciaId <= 0
  ) {
    res.status(400).json({
      ok: false,
      mensaje: "Apariencia no válida",
    });
    return;
  }

  try {
    await desbloquearApariencia(
      usuarioId,
      aparienciaId
    );

    const resumen =
      await obtenerResumenGamificacion(usuarioId);

    res.json({
      ok: true,
      mensaje: "Apariencia desbloqueada",
      resumen,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      mensaje: mensajeError(error),
    });
  }
}

export async function seleccionarApariencia(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = obtenerUsuarioId(req, res);
  if (!usuarioId) return;

  const aparienciaId = Number(
    req.params.aparienciaId
  );

  if (
    !Number.isInteger(aparienciaId) ||
    aparienciaId <= 0
  ) {
    res.status(400).json({
      ok: false,
      mensaje: "Apariencia no válida",
    });
    return;
  }

  try {
    await equiparApariencia(
      usuarioId,
      aparienciaId
    );

    const resumen =
      await obtenerResumenGamificacion(usuarioId);

    res.json({
      ok: true,
      mensaje: "Apariencia equipada",
      resumen,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      mensaje: mensajeError(error),
    });
  }
}