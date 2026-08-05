
import type { Response } from "express";
import bcrypt from "bcryptjs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { pool } from "../config/database";
import type { AuthRequest } from "../middleware/authMiddleware";

type Tema = "claro" | "oscuro";
type TamanoTexto = "pequeno" | "mediano" | "grande" | "muy_grande";

interface UsuarioFila extends RowDataPacket {
  id: number;
  nombre: string;
  apellido: string | null;
  correo: string;
  telefono: string | null;
  foto_url: string | null;
  proveedor: "local" | "google";
  password_hash?: string | null;
  tema: Tema | null;
  tamano_texto: TamanoTexto | null;
  recordatorios_gastos: number | null;
  notificaciones_metas: number | null;
  resumenes_semanales: number | null;
}


interface DispositivoConfianzaFila extends RowDataPacket {
  id: number;
  dispositivo_id: string;
  nombre: string;
  navegador: string | null;
  sistema_operativo: string | null;
  ultima_ip: string | null;
  confiable: number;
  ultimo_acceso: Date;
  creado_en: Date;
}

interface HistorialAccesoFila extends RowDataPacket {
  id: number;
  fecha_acceso: Date;
  direccion_ip: string | null;
  navegador: string | null;
  sistema_operativo: string | null;
  dispositivo: string | null;
  exitoso: number;
}

interface PreferenciasBody {
  tema?: Tema;
  tamanoTexto?: TamanoTexto;
  recordatoriosGastos?: boolean;
  notificacionesMetas?: boolean;
  resumenesSemanales?: boolean;
}

function limpiarTelefono(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

function esTema(valor: unknown): valor is Tema {
  return valor === "claro" || valor === "oscuro";
}

function esTamanoTexto(valor: unknown): valor is TamanoTexto {
  return (
    valor === "pequeno" ||
    valor === "mediano" ||
    valor === "grande" ||
    valor === "muy_grande"
  );
}

export async function obtenerConfiguracion(
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
    const [filas] = await pool.query<UsuarioFila[]>(
      `
        SELECT
          u.id,
          u.nombre,
          u.apellido,
          u.correo,
          u.telefono,
          u.foto_url,
          u.proveedor,
          cu.tema,
          cu.tamano_texto,
          cu.recordatorios_gastos,
          cu.notificaciones_metas,
          cu.resumenes_semanales
        FROM usuarios u
        LEFT JOIN configuracion_usuarios cu
          ON cu.usuario_id = u.id
        WHERE u.id = ?
          AND u.activo = 1
        LIMIT 1
      `,
      [usuarioId]
    );

    const usuario = filas[0];

    if (!usuario) {
      res.status(404).json({
        ok: false,
        mensaje: "Usuario no encontrado",
      });
      return;
    }

    res.json({
      ok: true,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        correo: usuario.correo,
        telefono: usuario.telefono,
        fotoUrl: usuario.foto_url,
        proveedor: usuario.proveedor,
      },
      preferencias: {
        tema: usuario.tema ?? "claro",
        tamanoTexto: usuario.tamano_texto ?? "mediano",
        recordatoriosGastos:
          usuario.recordatorios_gastos === null
            ? true
            : Boolean(usuario.recordatorios_gastos),
        notificacionesMetas:
          usuario.notificaciones_metas === null
            ? true
            : Boolean(usuario.notificaciones_metas),
        resumenesSemanales:
          usuario.resumenes_semanales === null
            ? false
            : Boolean(usuario.resumenes_semanales),
      },
    });
  } catch (error) {
    console.error("Error al obtener configuración:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo cargar la configuración",
    });
  }
}

export async function actualizarNombre(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const nombre = String(req.body?.nombre ?? "").trim();

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  if (nombre.length < 2) {
    res.status(400).json({
      ok: false,
      mensaje: "El nombre debe tener al menos 2 caracteres",
    });
    return;
  }

  if (nombre.length > 100) {
    res.status(400).json({
      ok: false,
      mensaje: "El nombre no puede superar los 100 caracteres",
    });
    return;
  }

  try {
    const [resultado] = await pool.query<ResultSetHeader>(
      `
        UPDATE usuarios
        SET
          nombre = ?,
          actualizado_en = CURRENT_TIMESTAMP
        WHERE id = ?
          AND activo = 1
      `,
      [nombre, usuarioId]
    );

    if (resultado.affectedRows === 0) {
      res.status(404).json({
        ok: false,
        mensaje: "Usuario no encontrado",
      });
      return;
    }

    res.json({
      ok: true,
      mensaje: "Nombre actualizado correctamente",
      nombre,
    });
  } catch (error) {
    console.error("Error al actualizar nombre:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo actualizar el nombre",
    });
  }
}

export async function actualizarTelefono(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const telefono = limpiarTelefono(req.body?.telefono);

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  if (telefono.length !== 10) {
    res.status(400).json({
      ok: false,
      mensaje: "El número debe contener exactamente 10 dígitos",
    });
    return;
  }

  try {
    const [resultado] = await pool.query<ResultSetHeader>(
      `
        UPDATE usuarios
        SET
          telefono = ?,
          actualizado_en = CURRENT_TIMESTAMP
        WHERE id = ?
          AND activo = 1
      `,
      [telefono, usuarioId]
    );

    if (resultado.affectedRows === 0) {
      res.status(404).json({
        ok: false,
        mensaje: "Usuario no encontrado",
      });
      return;
    }

    res.json({
      ok: true,
      mensaje: "Teléfono actualizado correctamente",
      telefono,
    });
  } catch (error) {
    console.error("Error al actualizar teléfono:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo actualizar el teléfono",
    });
  }
}

export async function actualizarPreferencias(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const body = (req.body ?? {}) as PreferenciasBody;

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  if (!esTema(body.tema)) {
    res.status(400).json({
      ok: false,
      mensaje: "Tema inválido",
    });
    return;
  }

  if (!esTamanoTexto(body.tamanoTexto)) {
    res.status(400).json({
      ok: false,
      mensaje: "Tamaño de texto inválido",
    });
    return;
  }

  if (
    typeof body.recordatoriosGastos !== "boolean" ||
    typeof body.notificacionesMetas !== "boolean" ||
    typeof body.resumenesSemanales !== "boolean"
  ) {
    res.status(400).json({
      ok: false,
      mensaje: "Las preferencias de notificaciones son inválidas",
    });
    return;
  }

  try {
    await pool.query<ResultSetHeader>(
      `
        INSERT INTO configuracion_usuarios (
          usuario_id,
          tema,
          tamano_texto,
          recordatorios_gastos,
          notificaciones_metas,
          resumenes_semanales
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          tema = VALUES(tema),
          tamano_texto = VALUES(tamano_texto),
          recordatorios_gastos = VALUES(recordatorios_gastos),
          notificaciones_metas = VALUES(notificaciones_metas),
          resumenes_semanales = VALUES(resumenes_semanales),
          actualizado_en = CURRENT_TIMESTAMP
      `,
      [
        usuarioId,
        body.tema,
        body.tamanoTexto,
        body.recordatoriosGastos ? 1 : 0,
        body.notificacionesMetas ? 1 : 0,
        body.resumenesSemanales ? 1 : 0,
      ]
    );

    res.json({
      ok: true,
      mensaje: "Preferencias actualizadas correctamente",
      preferencias: {
        tema: body.tema,
        tamanoTexto: body.tamanoTexto,
        recordatoriosGastos: body.recordatoriosGastos,
        notificacionesMetas: body.notificacionesMetas,
        resumenesSemanales: body.resumenesSemanales,
      },
    });
  } catch (error) {
    console.error("Error al actualizar preferencias:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudieron actualizar las preferencias",
    });
  }
}

export async function actualizarCorreo(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const correo = String(req.body?.correo ?? "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password ?? "");

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!correoValido.test(correo)) {
    res.status(400).json({
      ok: false,
      mensaje: "Escribe un correo electrónico válido",
    });
    return;
  }

  if (!password) {
    res.status(400).json({
      ok: false,
      mensaje: "Escribe tu contraseña actual",
    });
    return;
  }

  try {
    const [usuarios] = await pool.query<UsuarioFila[]>(
      `
        SELECT
          id,
          correo,
          proveedor,
          password_hash
        FROM usuarios
        WHERE id = ?
          AND activo = 1
        LIMIT 1
      `,
      [usuarioId]
    );

    const usuario = usuarios[0];

    if (!usuario) {
      res.status(404).json({
        ok: false,
        mensaje: "Usuario no encontrado",
      });
      return;
    }

    if (usuario.proveedor !== "local") {
      res.status(400).json({
        ok: false,
        mensaje:
          "El correo de una cuenta de Google se administra desde Google",
      });
      return;
    }

    if (!usuario.password_hash) {
      res.status(400).json({
        ok: false,
        mensaje: "La cuenta no tiene una contraseña local configurada",
      });
      return;
    }

    const passwordCorrecto = await bcrypt.compare(
      password,
      usuario.password_hash
    );

    if (!passwordCorrecto) {
      res.status(401).json({
        ok: false,
        mensaje: "La contraseña actual es incorrecta",
      });
      return;
    }

    const [existentes] = await pool.query<UsuarioFila[]>(
      `
        SELECT id
        FROM usuarios
        WHERE correo = ?
          AND id <> ?
        LIMIT 1
      `,
      [correo, usuarioId]
    );

    if (existentes.length > 0) {
      res.status(409).json({
        ok: false,
        mensaje: "Ya existe una cuenta con ese correo",
      });
      return;
    }

    const [resultado] = await pool.query<ResultSetHeader>(
      `
        UPDATE usuarios
        SET
          correo = ?,
          correo_verificado = 0,
          actualizado_en = CURRENT_TIMESTAMP
        WHERE id = ?
          AND activo = 1
      `,
      [correo, usuarioId]
    );

    if (resultado.affectedRows === 0) {
      res.status(404).json({
        ok: false,
        mensaje: "Usuario no encontrado",
      });
      return;
    }

    res.json({
      ok: true,
      mensaje: "Correo actualizado correctamente",
      correo,
      requiereNuevoInicioDeSesion: true,
    });
  } catch (error) {
    console.error("Error al actualizar correo:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo actualizar el correo",
    });
  }
}

export async function actualizarPassword(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const passwordActual = String(req.body?.passwordActual ?? "");
  const passwordNueva = String(req.body?.passwordNueva ?? "");
  const confirmacion = String(req.body?.confirmacion ?? "");

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  if (!passwordActual || !passwordNueva || !confirmacion) {
    res.status(400).json({
      ok: false,
      mensaje: "Completa todos los campos",
    });
    return;
  }

  if (passwordNueva.length < 8) {
    res.status(400).json({
      ok: false,
      mensaje: "La nueva contraseña debe tener al menos 8 caracteres",
    });
    return;
  }

  if (passwordNueva !== confirmacion) {
    res.status(400).json({
      ok: false,
      mensaje: "La confirmación no coincide con la nueva contraseña",
    });
    return;
  }

  if (passwordActual === passwordNueva) {
    res.status(400).json({
      ok: false,
      mensaje: "La nueva contraseña debe ser diferente a la actual",
    });
    return;
  }

  try {
    const [usuarios] = await pool.query<UsuarioFila[]>(
      `
        SELECT
          id,
          proveedor,
          password_hash
        FROM usuarios
        WHERE id = ?
          AND activo = 1
        LIMIT 1
      `,
      [usuarioId]
    );

    const usuario = usuarios[0];

    if (!usuario) {
      res.status(404).json({
        ok: false,
        mensaje: "Usuario no encontrado",
      });
      return;
    }

    if (usuario.proveedor !== "local") {
      res.status(400).json({
        ok: false,
        mensaje:
          "La contraseña de una cuenta de Google se administra desde Google",
      });
      return;
    }

    if (!usuario.password_hash) {
      res.status(400).json({
        ok: false,
        mensaje: "La cuenta no tiene una contraseña local configurada",
      });
      return;
    }

    const passwordCorrecto = await bcrypt.compare(
      passwordActual,
      usuario.password_hash
    );

    if (!passwordCorrecto) {
      res.status(401).json({
        ok: false,
        mensaje: "La contraseña actual es incorrecta",
      });
      return;
    }

    const passwordHash = await bcrypt.hash(passwordNueva, 12);

    const [resultado] = await pool.query<ResultSetHeader>(
      `
        UPDATE usuarios
        SET
          password_hash = ?,
          actualizado_en = CURRENT_TIMESTAMP
        WHERE id = ?
          AND activo = 1
      `,
      [passwordHash, usuarioId]
    );

    if (resultado.affectedRows === 0) {
      res.status(404).json({
        ok: false,
        mensaje: "Usuario no encontrado",
      });
      return;
    }

    res.json({
      ok: true,
      mensaje: "Contraseña actualizada correctamente",
    });
  } catch (error) {
    console.error("Error al actualizar contraseña:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo actualizar la contraseña",
    });
  }
}

export async function obtenerHistorialAccesos(
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
    const [filas] = await pool.query<HistorialAccesoFila[]>(
      `
        SELECT
          id,
          fecha_acceso,
          direccion_ip,
          navegador,
          sistema_operativo,
          dispositivo,
          exitoso
        FROM historial_accesos
        WHERE usuario_id = ?
        ORDER BY fecha_acceso DESC, id DESC
        LIMIT 50
      `,
      [usuarioId]
    );

    res.json({
      ok: true,
      accesos: filas.map((acceso, indice) => ({
        id: acceso.id,
        fechaAcceso: acceso.fecha_acceso,
        direccionIp: acceso.direccion_ip,
        navegador: acceso.navegador,
        sistemaOperativo: acceso.sistema_operativo,
        dispositivo: acceso.dispositivo,
        exitoso: Boolean(acceso.exitoso),
        actual: indice === 0,
      })),
    });
  } catch (error) {
    console.error("Error al obtener historial de accesos:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo cargar el historial de accesos",
    });
  }
}

export async function obtenerDispositivosConfianza(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const dispositivoActualId = String(
    req.query?.dispositivoId ?? ""
  ).trim();

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  try {
    const [filas] = await pool.query<DispositivoConfianzaFila[]>(
      `
        SELECT
          id,
          dispositivo_id,
          nombre,
          navegador,
          sistema_operativo,
          ultima_ip,
          confiable,
          ultimo_acceso,
          creado_en
        FROM dispositivos_confianza
        WHERE usuario_id = ?
        ORDER BY ultimo_acceso DESC, id DESC
      `,
      [usuarioId]
    );

    res.json({
      ok: true,
      dispositivos: filas.map((dispositivo) => ({
        id: dispositivo.id,
        dispositivoId: dispositivo.dispositivo_id,
        nombre: dispositivo.nombre,
        navegador: dispositivo.navegador,
        sistemaOperativo: dispositivo.sistema_operativo,
        ultimaIp: dispositivo.ultima_ip,
        confiable: Boolean(dispositivo.confiable),
        actual:
          dispositivoActualId.length > 0 &&
          dispositivo.dispositivo_id === dispositivoActualId,
        ultimoAcceso: dispositivo.ultimo_acceso,
        creadoEn: dispositivo.creado_en,
      })),
    });
  } catch (error) {
    console.error("Error al obtener dispositivos:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudieron cargar los dispositivos",
    });
  }
}

export async function actualizarConfianzaDispositivo(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const dispositivoId = String(
    req.params?.dispositivoId ?? ""
  ).trim();
  const confiable = req.body?.confiable;

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  if (!dispositivoId) {
    res.status(400).json({
      ok: false,
      mensaje: "Dispositivo inválido",
    });
    return;
  }

  if (typeof confiable !== "boolean") {
    res.status(400).json({
      ok: false,
      mensaje: "Estado de confianza inválido",
    });
    return;
  }

  try {
    const [resultado] = await pool.query<ResultSetHeader>(
      `
        UPDATE dispositivos_confianza
        SET
          confiable = ?,
          actualizado_en = CURRENT_TIMESTAMP
        WHERE usuario_id = ?
          AND dispositivo_id = ?
      `,
      [confiable ? 1 : 0, usuarioId, dispositivoId]
    );

    if (resultado.affectedRows === 0) {
      res.status(404).json({
        ok: false,
        mensaje: "Dispositivo no encontrado",
      });
      return;
    }

    res.json({
      ok: true,
      mensaje: confiable
        ? "Dispositivo marcado como confiable"
        : "Se quitó la confianza del dispositivo",
      dispositivoId,
      confiable,
    });
  } catch (error) {
    console.error("Error al actualizar dispositivo:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo actualizar el dispositivo",
    });
  }
}

export async function eliminarDispositivoConfianza(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const dispositivoId = String(
    req.params?.dispositivoId ?? ""
  ).trim();
  const dispositivoActualId = String(
    req.body?.dispositivoActualId ?? ""
  ).trim();

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  if (!dispositivoId) {
    res.status(400).json({
      ok: false,
      mensaje: "Dispositivo inválido",
    });
    return;
  }

  if (
    dispositivoActualId &&
    dispositivoId === dispositivoActualId
  ) {
    res.status(400).json({
      ok: false,
      mensaje:
        "No puedes eliminar el dispositivo que estás usando actualmente",
    });
    return;
  }

  try {
    const [resultado] = await pool.query<ResultSetHeader>(
      `
        DELETE FROM dispositivos_confianza
        WHERE usuario_id = ?
          AND dispositivo_id = ?
      `,
      [usuarioId, dispositivoId]
    );

    if (resultado.affectedRows === 0) {
      res.status(404).json({
        ok: false,
        mensaje: "Dispositivo no encontrado",
      });
      return;
    }

    res.json({
      ok: true,
      mensaje: "Dispositivo eliminado correctamente",
      dispositivoId,
    });
  } catch (error) {
    console.error("Error al eliminar dispositivo:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo eliminar el dispositivo",
    });
  }
}

/*
 * Alias de compatibilidad:
 * evita errores si algún archivo anterior importó el nombre en singular.
 */
export const obtenerDispositivoConfianza =
  obtenerDispositivosConfianza;

export async function eliminarCuenta(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const password = String(
    req.body?.password ?? ""
  );
  const confirmacion = String(
    req.body?.confirmacion ?? ""
  )
    .trim()
    .toUpperCase();

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  if (confirmacion !== "ELIMINAR") {
    res.status(400).json({
      ok: false,
      mensaje:
        'Escribe la palabra "ELIMINAR" para confirmar',
    });
    return;
  }

  if (!password) {
    res.status(400).json({
      ok: false,
      mensaje: "Escribe tu contraseña actual",
    });
    return;
  }

  try {
    const [usuarios] = await pool.query<UsuarioFila[]>(
      `
        SELECT
          id,
          proveedor,
          password_hash
        FROM usuarios
        WHERE id = ?
          AND activo = 1
        LIMIT 1
      `,
      [usuarioId]
    );

    const usuario = usuarios[0];

    if (!usuario) {
      res.status(404).json({
        ok: false,
        mensaje: "Usuario no encontrado",
      });
      return;
    }

    if (
      usuario.proveedor !== "local" ||
      !usuario.password_hash
    ) {
      res.status(400).json({
        ok: false,
        mensaje:
          "Esta cuenta no admite eliminación con contraseña local",
      });
      return;
    }

    const passwordCorrecto = await bcrypt.compare(
      password,
      usuario.password_hash
    );

    if (!passwordCorrecto) {
      res.status(401).json({
        ok: false,
        mensaje: "La contraseña actual es incorrecta",
      });
      return;
    }

    const conexion = await pool.getConnection();

    try {
      await conexion.beginTransaction();

      const [resultado] =
        await conexion.query<ResultSetHeader>(
          `
            DELETE FROM usuarios
            WHERE id = ?
          `,
          [usuarioId]
        );

      if (resultado.affectedRows === 0) {
        throw new Error(
          "No se encontró la cuenta para eliminar"
        );
      }

      await conexion.commit();
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }

    res.json({
      ok: true,
      mensaje: "Cuenta eliminada correctamente",
    });
  } catch (error) {
    console.error("Error al eliminar cuenta:", error);

    const codigo =
      typeof error === "object" &&
      error !== null &&
      "code" in error
        ? String(error.code)
        : "";

    if (
      codigo === "ER_ROW_IS_REFERENCED_2" ||
      codigo === "ER_ROW_IS_REFERENCED"
    ) {
      res.status(409).json({
        ok: false,
        mensaje:
          "No se pudo eliminar la cuenta porque existen registros relacionados sin eliminación en cascada",
      });
      return;
    }

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo eliminar la cuenta",
    });
  }
}
