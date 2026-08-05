import type { Response } from "express";
import bcrypt from "bcryptjs";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import QRCode from "qrcode";
import { generateSecret, generateURI } from "otplib";

import { pool } from "../config/database";
import type { AuthRequest } from "../middleware/authMiddleware";
import {
  cifrarSecreto,
  crearCodigosRecuperacion,
  descifrarSecreto,
  verificarCodigoTotp,
} from "../services/twoFactorService";

interface Configuracion2FAFila extends RowDataPacket {
  usuario_id: number;
  secreto_cifrado: string | null;
  activo: number;
  codigos_recuperacion: string | null;
  activado_en: Date | null;
  ultimo_uso_en: Date | null;
}

interface Usuario2FAFila extends RowDataPacket {
  correo: string;
  password_hash: string | null;
  proveedor: "local" | "google";
}

export async function obtenerEstado2FA(
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
    const [filas] = await pool.query<Configuracion2FAFila[]>(
      `
        SELECT
          usuario_id,
          activo,
          activado_en,
          ultimo_uso_en
        FROM configuracion_2fa
        WHERE usuario_id = ?
        LIMIT 1
      `,
      [usuarioId]
    );

    const configuracion = filas[0];

    res.json({
      ok: true,
      activo: Boolean(configuracion?.activo),
      activadoEn: configuracion?.activado_en ?? null,
      ultimoUsoEn: configuracion?.ultimo_uso_en ?? null,
    });
  } catch (error) {
    console.error("Error al obtener estado 2FA:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo cargar el estado de 2 pasos",
    });
  }
}

export async function preparar2FA(
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
    const [usuarios] = await pool.query<Usuario2FAFila[]>(
      `
        SELECT correo, password_hash, proveedor
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

    const secreto = generateSecret();

    const uri = generateURI({
      issuer: "Balance Digital",
      label: usuario.correo,
      secret: secreto,
    });

    const qrDataUrl = await QRCode.toDataURL(uri, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 280,
    });

    await pool.query<ResultSetHeader>(
      `
        INSERT INTO configuracion_2fa (
          usuario_id,
          secreto_cifrado,
          activo,
          codigos_recuperacion
        )
        VALUES (?, ?, 0, NULL)
        ON DUPLICATE KEY UPDATE
          secreto_cifrado = VALUES(secreto_cifrado),
          activo = 0,
          codigos_recuperacion = NULL,
          activado_en = NULL,
          actualizado_en = CURRENT_TIMESTAMP
      `,
      [usuarioId, cifrarSecreto(secreto)]
    );

    res.json({
      ok: true,
      mensaje: "Configuración 2FA preparada",
      qrDataUrl,
      secretoManual: secreto,
      cuenta: usuario.correo,
    });
  } catch (error) {
    console.error("Error al preparar 2FA:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo preparar la verificación en 2 pasos",
    });
  }
}

export async function activar2FA(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const codigo = String(req.body?.codigo ?? "");

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  try {
    const [filas] = await pool.query<Configuracion2FAFila[]>(
      `
        SELECT secreto_cifrado
        FROM configuracion_2fa
        WHERE usuario_id = ?
        LIMIT 1
      `,
      [usuarioId]
    );

    const configuracion = filas[0];

    if (!configuracion?.secreto_cifrado) {
      res.status(400).json({
        ok: false,
        mensaje: "Primero genera el código QR",
      });
      return;
    }

    const secreto = descifrarSecreto(
      configuracion.secreto_cifrado
    );

    const codigoValido = await verificarCodigoTotp(
      secreto,
      codigo
    );

    if (!codigoValido) {
      res.status(400).json({
        ok: false,
        mensaje: "El código de 6 dígitos no es válido",
      });
      return;
    }

    const recuperacion = await crearCodigosRecuperacion();

    await pool.query<ResultSetHeader>(
      `
        UPDATE configuracion_2fa
        SET
          activo = 1,
          codigos_recuperacion = ?,
          activado_en = CURRENT_TIMESTAMP,
          ultimo_uso_en = CURRENT_TIMESTAMP,
          actualizado_en = CURRENT_TIMESTAMP
        WHERE usuario_id = ?
      `,
      [JSON.stringify(recuperacion.hashes), usuarioId]
    );

    res.json({
      ok: true,
      mensaje: "Verificación en 2 pasos activada",
      codigosRecuperacion: recuperacion.planos,
    });
  } catch (error) {
    console.error("Error al activar 2FA:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo activar la verificación en 2 pasos",
    });
  }
}

export async function desactivar2FA(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const password = String(req.body?.password ?? "");
  const codigo = String(req.body?.codigo ?? "");

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  if (!password || !codigo) {
    res.status(400).json({
      ok: false,
      mensaje: "Contraseña y código son obligatorios",
    });
    return;
  }

  try {
    const [usuarios] = await pool.query<Usuario2FAFila[]>(
      `
        SELECT password_hash, proveedor
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

    if (usuario.proveedor !== "local" || !usuario.password_hash) {
      res.status(400).json({
        ok: false,
        mensaje: "La cuenta no admite validación con contraseña local",
      });
      return;
    }

    const passwordValido = await bcrypt.compare(
      password,
      usuario.password_hash
    );

    if (!passwordValido) {
      res.status(401).json({
        ok: false,
        mensaje: "La contraseña actual es incorrecta",
      });
      return;
    }

    const [filas] = await pool.query<Configuracion2FAFila[]>(
      `
        SELECT secreto_cifrado, activo
        FROM configuracion_2fa
        WHERE usuario_id = ?
        LIMIT 1
      `,
      [usuarioId]
    );

    const configuracion = filas[0];

    if (!configuracion?.activo || !configuracion.secreto_cifrado) {
      res.status(400).json({
        ok: false,
        mensaje: "La verificación en 2 pasos no está activa",
      });
      return;
    }

    const codigoValido = await verificarCodigoTotp(
      descifrarSecreto(configuracion.secreto_cifrado),
      codigo
    );

    if (!codigoValido) {
      res.status(400).json({
        ok: false,
        mensaje: "El código de autenticación no es válido",
      });
      return;
    }

    await pool.query<ResultSetHeader>(
      `
        UPDATE configuracion_2fa
        SET
          secreto_cifrado = NULL,
          activo = 0,
          codigos_recuperacion = NULL,
          activado_en = NULL,
          ultimo_uso_en = NULL,
          actualizado_en = CURRENT_TIMESTAMP
        WHERE usuario_id = ?
      `,
      [usuarioId]
    );

    res.json({
      ok: true,
      mensaje: "Verificación en 2 pasos desactivada",
    });
  } catch (error) {
    console.error("Error al desactivar 2FA:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo desactivar la verificación en 2 pasos",
    });
  }
}