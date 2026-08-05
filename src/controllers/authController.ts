
import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomInt } from "crypto";
import { verify as verificarTotp } from "otplib";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { pool } from "../config/database";
import type { AuthRequest } from "../middleware/authMiddleware";
import { registrarInicioSesionGamificacion } from "../services/gamificacionService";
import {
  enviarCodigoRecuperacion,
  enviarCodigoVerificacionCorreo,
} from "../services/correoService";
import {
  consumirCodigoRecuperacion,
  descifrarSecreto,
  limpiarCodigo2FA,
} from "../services/twoFactorService";

interface UsuarioRow extends RowDataPacket {
  id: number;
  nombre: string;
  apellido: string | null;
  correo: string;
  password_hash: string;
  telefono: string | null;
  foto_url: string | null;
  activo: number;
  correo_verificado: number;
  ultimo_acceso: Date | null;
}


interface Configuracion2FAAuthRow extends RowDataPacket {
  secreto_cifrado: string | null;
  activo: number;
  codigos_recuperacion: string | null;
}

interface DispositivoConfiableRow extends RowDataPacket {
  confiable: number;
}


interface RecuperacionPasswordRow extends RowDataPacket {
  id: number;
  usuario_id: number;
  codigo_hash: string;
  expira_en: Date;
  intentos: number;
  utilizado: number;
}


interface VerificacionCorreoRow extends RowDataPacket {
  id: number;
  usuario_id: number;
  codigo_hash: string;
  expira_en: Date;
  intentos: number;
  utilizado: number;
}

interface Desafio2FAPayload {
  tipo: "2fa";
  usuarioId: number;
  dispositivoId: string;
  nombreDispositivo: string;
  navegador: string;
  sistemaOperativo: string;
  ip: string;
}

function crearToken(usuario: {
  id: number;
  nombre: string;
  correo: string;
}): string {
  const secreto = process.env.JWT_SECRET;

  if (!secreto) {
    throw new Error("JWT_SECRET no está configurado");
  }

  return jwt.sign(
    { usuario },
    secreto,
    { expiresIn: "7d" }
  );
}

function crearTokenDesafio2FA(
  payload: Desafio2FAPayload
): string {
  const secreto = process.env.JWT_SECRET;

  if (!secreto) {
    throw new Error("JWT_SECRET no está configurado");
  }

  return jwt.sign(payload, secreto, {
    expiresIn: "5m",
  });
}

function verificarTokenDesafio2FA(
  token: string
): Desafio2FAPayload {
  const secreto = process.env.JWT_SECRET;

  if (!secreto) {
    throw new Error("JWT_SECRET no está configurado");
  }

  const payload = jwt.verify(
    token,
    secreto
  ) as Desafio2FAPayload;

  if (payload.tipo !== "2fa") {
    throw new Error("Desafío 2FA inválido");
  }

  return payload;
}

async function registrarDispositivo(
  usuarioId: number,
  datos: {
    dispositivoId: string;
    nombreDispositivo: string;
    navegador: string;
    sistemaOperativo: string;
    ip: string;
  }
): Promise<void> {
  if (!datos.dispositivoId) return;

  await pool.query<ResultSetHeader>(
    `
      INSERT INTO dispositivos_confianza (
        usuario_id,
        dispositivo_id,
        nombre,
        navegador,
        sistema_operativo,
        ultima_ip,
        confiable,
        ultimo_acceso
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        nombre = VALUES(nombre),
        navegador = VALUES(navegador),
        sistema_operativo = VALUES(sistema_operativo),
        ultima_ip = VALUES(ultima_ip),
        ultimo_acceso = CURRENT_TIMESTAMP,
        actualizado_en = CURRENT_TIMESTAMP
    `,
    [
      usuarioId,
      datos.dispositivoId,
      datos.nombreDispositivo,
      datos.navegador,
      datos.sistemaOperativo,
      datos.ip,
    ]
  );
}

async function registrarAcceso(
  usuarioId: number,
  datos: {
    ip: string;
    navegador: string;
    sistemaOperativo: string;
    nombreDispositivo: string;
  }
): Promise<void> {
  await pool.query(
    `
      CALL sp_registrar_acceso_usuario(
        ?,
        ?,
        ?,
        ?,
        ?
      )
    `,
    [
      usuarioId,
      datos.ip,
      datos.navegador,
      datos.sistemaOperativo,
      datos.nombreDispositivo,
    ]
  );
}

function textoSeguro(valor: unknown, maximo: number): string {
  return String(valor ?? "").trim().slice(0, maximo);
}


function correoValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
}

function passwordSegura(password: string): boolean {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password)
  );
}

export async function registrarUsuario(
  req: Request,
  res: Response
): Promise<void> {
  const { nombre, apellido, correo, password, telefono } = req.body;

  if (!nombre || !correo || !password) {
    res.status(400).json({
      ok: false,
      mensaje: "Nombre, correo y contraseña son obligatorios",
    });
    return;
  }

  const nombreLimpio = String(nombre).trim();
  const apellidoLimpio = apellido
    ? String(apellido).trim()
    : null;
  const correoNormalizado = String(correo)
    .trim()
    .toLowerCase();
  const telefonoLimpio = telefono
    ? String(telefono).replace(/\D/g, "").slice(0, 10)
    : null;

  if (nombreLimpio.length < 2) {
    res.status(400).json({
      ok: false,
      mensaje: "El nombre no es válido",
    });
    return;
  }

  if (!correoValido(correoNormalizado)) {
    res.status(400).json({
      ok: false,
      mensaje: "El correo electrónico no es válido",
    });
    return;
  }

  if (!passwordSegura(String(password))) {
    res.status(400).json({
      ok: false,
      mensaje:
        "La contraseña debe tener al menos 8 caracteres, mayúscula, minúscula y número",
    });
    return;
  }

  try {
    const [usuariosExistentes] =
      await pool.query<UsuarioRow[]>(
        `
          SELECT
            id,
            nombre,
            correo,
            correo_verificado
          FROM usuarios
          WHERE correo = ?
          LIMIT 1
        `,
        [correoNormalizado]
      );

    if (usuariosExistentes.length > 0) {
      const existente = usuariosExistentes[0];

      if (existente.correo_verificado) {
        res.status(409).json({
          ok: false,
          mensaje: "Ya existe una cuenta con ese correo",
        });
        return;
      }

      res.status(409).json({
        ok: false,
        mensaje:
          "Ese correo ya tiene un registro pendiente. Usa reenviar código.",
        requiereVerificacion: true,
        correo: correoNormalizado,
      });
      return;
    }

    const passwordHash = await bcrypt.hash(
      String(password),
      12
    );

    const codigo = String(
      randomInt(100000, 1000000)
    );

    const codigoHash = await bcrypt.hash(codigo, 10);

    const conexion = await pool.getConnection();

    let usuarioId = 0;

    try {
      await conexion.beginTransaction();

      const [resultado] =
        await conexion.execute<ResultSetHeader>(
          `
            INSERT INTO usuarios (
              nombre,
              apellido,
              correo,
              password_hash,
              telefono,
              proveedor,
              activo,
              correo_verificado
            )
            VALUES (?, ?, ?, ?, ?, 'local', TRUE, FALSE)
          `,
          [
            nombreLimpio,
            apellidoLimpio,
            correoNormalizado,
            passwordHash,
            telefonoLimpio,
          ]
        );

      usuarioId = resultado.insertId;

      await conexion.execute<ResultSetHeader>(
        `
          INSERT INTO verificaciones_correo (
            usuario_id,
            codigo_hash,
            expira_en,
            intentos,
            utilizado
          )
          VALUES (
            ?,
            ?,
            DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE),
            0,
            0
          )
        `,
        [usuarioId, codigoHash]
      );

      await conexion.commit();
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }

    try {
      await enviarCodigoVerificacionCorreo(
        correoNormalizado,
        nombreLimpio,
        codigo
      );
    } catch (errorCorreo) {
      await pool.query(
        `
          DELETE FROM usuarios
          WHERE id = ?
            AND correo_verificado = 0
        `,
        [usuarioId]
      );

      console.error(
        "Error al enviar verificación de correo:",
        errorCorreo
      );

      res.status(502).json({
        ok: false,
        mensaje:
          "No se pudo enviar el código de verificación. Revisa el correo e inténtalo otra vez.",
      });
      return;
    }

    res.status(201).json({
      ok: true,
      mensaje:
        "Cuenta creada. Revisa tu correo para verificarla.",
      requiereVerificacion: true,
      correo: correoNormalizado,
    });
  } catch (error) {
    console.error("Error al registrar usuario:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo registrar el usuario",
    });
  }
}

export async function verificarCorreoRegistro(
  req: Request,
  res: Response
): Promise<void> {
  const correo = String(req.body?.correo ?? "")
    .trim()
    .toLowerCase();

  const codigo = String(req.body?.codigo ?? "")
    .replace(/\D/g, "")
    .slice(0, 6);

  if (!correoValido(correo) || codigo.length !== 6) {
    res.status(400).json({
      ok: false,
      mensaje: "Correo o código no válidos",
    });
    return;
  }

  try {
    const [usuarios] = await pool.query<UsuarioRow[]>(
      `
        SELECT
          id,
          nombre,
          apellido,
          correo,
          telefono,
          foto_url,
          activo,
          correo_verificado
        FROM usuarios
        WHERE correo = ?
        LIMIT 1
      `,
      [correo]
    );

    const usuarioDb = usuarios[0];

    if (!usuarioDb || !usuarioDb.activo) {
      res.status(400).json({
        ok: false,
        mensaje: "El código no es válido o ya expiró",
      });
      return;
    }

    if (usuarioDb.correo_verificado) {
      const usuario = {
        id: usuarioDb.id,
        nombre: usuarioDb.nombre,
        apellido: usuarioDb.apellido,
        correo: usuarioDb.correo,
        telefono: usuarioDb.telefono,
        fotoUrl: usuarioDb.foto_url,
      };

      res.json({
        ok: true,
        mensaje: "El correo ya estaba verificado",
        token: crearToken({
          id: usuarioDb.id,
          nombre: usuarioDb.nombre,
          correo: usuarioDb.correo,
        }),
        usuario,
      });
      return;
    }

    const [verificaciones] =
      await pool.query<VerificacionCorreoRow[]>(
        `
          SELECT
            id,
            usuario_id,
            codigo_hash,
            expira_en,
            intentos,
            utilizado
          FROM verificaciones_correo
          WHERE usuario_id = ?
            AND utilizado = 0
            AND expira_en > CURRENT_TIMESTAMP
          ORDER BY id DESC
          LIMIT 1
        `,
        [usuarioDb.id]
      );

    const verificacion = verificaciones[0];

    if (!verificacion || verificacion.intentos >= 5) {
      res.status(400).json({
        ok: false,
        mensaje:
          "El código expiró o superó el máximo de intentos",
      });
      return;
    }

    const coincide = await bcrypt.compare(
      codigo,
      verificacion.codigo_hash
    );

    if (!coincide) {
      await pool.query<ResultSetHeader>(
        `
          UPDATE verificaciones_correo
          SET intentos = intentos + 1
          WHERE id = ?
        `,
        [verificacion.id]
      );

      res.status(400).json({
        ok: false,
        mensaje: "El código de verificación no es válido",
      });
      return;
    }

    const conexion = await pool.getConnection();

    try {
      await conexion.beginTransaction();

      await conexion.query<ResultSetHeader>(
        `
          UPDATE usuarios
          SET
            correo_verificado = 1,
            actualizado_en = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [usuarioDb.id]
      );

      await conexion.query<ResultSetHeader>(
        `
          UPDATE verificaciones_correo
          SET utilizado = 1
          WHERE usuario_id = ?
        `,
        [usuarioDb.id]
      );

      await conexion.commit();
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }

    const usuario = {
      id: usuarioDb.id,
      nombre: usuarioDb.nombre,
      apellido: usuarioDb.apellido,
      correo: usuarioDb.correo,
      telefono: usuarioDb.telefono,
      fotoUrl: usuarioDb.foto_url,
    };

    const token = crearToken({
      id: usuarioDb.id,
      nombre: usuarioDb.nombre,
      correo: usuarioDb.correo,
    });

    res.json({
      ok: true,
      mensaje: "Correo verificado correctamente",
      token,
      usuario,
    });
  } catch (error) {
    console.error("Error al verificar correo:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo verificar el correo",
    });
  }
}

export async function reenviarCodigoVerificacion(
  req: Request,
  res: Response
): Promise<void> {
  const correo = String(req.body?.correo ?? "")
    .trim()
    .toLowerCase();

  if (!correoValido(correo)) {
    res.status(400).json({
      ok: false,
      mensaje: "Escribe un correo válido",
    });
    return;
  }

  try {
    const [usuarios] = await pool.query<UsuarioRow[]>(
      `
        SELECT
          id,
          nombre,
          correo,
          activo,
          correo_verificado
        FROM usuarios
        WHERE correo = ?
        LIMIT 1
      `,
      [correo]
    );

    const usuario = usuarios[0];

    if (
      !usuario ||
      !usuario.activo ||
      usuario.correo_verificado
    ) {
      res.json({
        ok: true,
        mensaje:
          "Si la cuenta está pendiente, se enviará un código nuevo.",
      });
      return;
    }

    const [recientes] = await pool.query<RowDataPacket[]>(
      `
        SELECT id
        FROM verificaciones_correo
        WHERE usuario_id = ?
          AND creado_en >
            DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 60 SECOND)
        ORDER BY id DESC
        LIMIT 1
      `,
      [usuario.id]
    );

    if (recientes.length > 0) {
      res.status(429).json({
        ok: false,
        mensaje:
          "Espera un minuto antes de solicitar otro código",
      });
      return;
    }

    await pool.query<ResultSetHeader>(
      `
        UPDATE verificaciones_correo
        SET utilizado = 1
        WHERE usuario_id = ?
          AND utilizado = 0
      `,
      [usuario.id]
    );

    const codigo = String(
      randomInt(100000, 1000000)
    );

    const codigoHash = await bcrypt.hash(codigo, 10);

    const [resultado] =
      await pool.execute<ResultSetHeader>(
        `
          INSERT INTO verificaciones_correo (
            usuario_id,
            codigo_hash,
            expira_en,
            intentos,
            utilizado
          )
          VALUES (
            ?,
            ?,
            DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE),
            0,
            0
          )
        `,
        [usuario.id, codigoHash]
      );

    try {
      await enviarCodigoVerificacionCorreo(
        usuario.correo,
        usuario.nombre,
        codigo
      );
    } catch (errorCorreo) {
      await pool.query<ResultSetHeader>(
        `
          UPDATE verificaciones_correo
          SET utilizado = 1
          WHERE id = ?
        `,
        [resultado.insertId]
      );

      throw errorCorreo;
    }

    res.json({
      ok: true,
      mensaje: "Código reenviado correctamente",
    });
  } catch (error) {
    console.error(
      "Error al reenviar código de verificación:",
      error
    );

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo reenviar el código",
    });
  }
}

export async function iniciarSesion(
  req: Request,
  res: Response
): Promise<void> {
  const {
    correo,
    password,
    dispositivoId,
    nombreDispositivo,
    navegador: navegadorCliente,
    sistemaOperativo: sistemaCliente,
  } = req.body;

  if (!correo || !password) {
    res.status(400).json({
      ok: false,
      mensaje: "Correo y contraseña son obligatorios",
    });
    return;
  }

  const correoNormalizado = String(correo).trim().toLowerCase();

  try {
    const [usuarios] = await pool.query<UsuarioRow[]>(
      `
        SELECT
          id,
          nombre,
          apellido,
          correo,
          password_hash,
          telefono,
          foto_url,
          activo,
          correo_verificado,
          ultimo_acceso
        FROM usuarios
        WHERE correo = ?
        LIMIT 1
      `,
      [correoNormalizado]
    );

    if (usuarios.length === 0) {
      res.status(401).json({
        ok: false,
        mensaje: "Correo o contraseña incorrectos",
      });
      return;
    }

    const usuarioDb = usuarios[0];

    if (!usuarioDb.activo) {
      res.status(403).json({
        ok: false,
        mensaje: "La cuenta se encuentra desactivada",
      });
      return;
    }

    if (!usuarioDb.correo_verificado) {
      res.status(403).json({
        ok: false,
        mensaje:
          "Debes verificar tu correo antes de iniciar sesión",
        requiereVerificacion: true,
        correo: usuarioDb.correo,
      });
      return;
    }

    const passwordCorrecto = await bcrypt.compare(
      String(password),
      usuarioDb.password_hash
    );

    if (!passwordCorrecto) {
      res.status(401).json({
        ok: false,
        mensaje: "Correo o contraseña incorrectos",
      });
      return;
    }

    const ip =
      req.ip ??
      req.socket.remoteAddress ??
      "127.0.0.1";

    const navegador = textoSeguro(
      navegadorCliente || req.headers["user-agent"] || "Desconocido",
      120
    );

    const sistemaOperativo = textoSeguro(
      sistemaCliente || "Sistema desconocido",
      100
    );

    const nombreEquipo = textoSeguro(
      nombreDispositivo || "Dispositivo desconocido",
      120
    );

    const identificador = textoSeguro(dispositivoId, 80);

    await registrarDispositivo(usuarioDb.id, {
      dispositivoId: identificador,
      nombreDispositivo: nombreEquipo,
      navegador,
      sistemaOperativo,
      ip,
    });

    const [configuraciones] =
      await pool.query<Configuracion2FAAuthRow[]>(
        `
          SELECT
            secreto_cifrado,
            activo,
            codigos_recuperacion
          FROM configuracion_2fa
          WHERE usuario_id = ?
          LIMIT 1
        `,
        [usuarioDb.id]
      );

    const configuracion2FA = configuraciones[0];

    let dispositivoConfiable = false;

    if (identificador) {
      const [dispositivos] =
        await pool.query<DispositivoConfiableRow[]>(
          `
            SELECT confiable
            FROM dispositivos_confianza
            WHERE usuario_id = ?
              AND dispositivo_id = ?
            LIMIT 1
          `,
          [usuarioDb.id, identificador]
        );

      dispositivoConfiable = Boolean(
        dispositivos[0]?.confiable
      );
    }

    if (
      configuracion2FA?.activo &&
      configuracion2FA.secreto_cifrado &&
      !dispositivoConfiable
    ) {
      const desafioToken = crearTokenDesafio2FA({
        tipo: "2fa",
        usuarioId: usuarioDb.id,
        dispositivoId: identificador,
        nombreDispositivo: nombreEquipo,
        navegador,
        sistemaOperativo,
        ip,
      });

      res.json({
        ok: true,
        mensaje: "Código de verificación requerido",
        requiere2FA: true,
        desafioToken,
        usuario: {
          id: usuarioDb.id,
          nombre: usuarioDb.nombre,
          correo: usuarioDb.correo,
        },
      });
      return;
    }

    await registrarAcceso(usuarioDb.id, {
      ip,
      navegador,
      sistemaOperativo,
      nombreDispositivo: nombreEquipo,
    });

    await registrarInicioSesionGamificacion(
      usuarioDb.id
    );

    const usuario = {
      id: usuarioDb.id,
      nombre: usuarioDb.nombre,
      apellido: usuarioDb.apellido,
      correo: usuarioDb.correo,
      telefono: usuarioDb.telefono,
      fotoUrl: usuarioDb.foto_url,
    };

    const token = crearToken({
      id: usuarioDb.id,
      nombre: usuarioDb.nombre,
      correo: usuarioDb.correo,
    });

    res.json({
      ok: true,
      mensaje: "Inicio de sesión correcto",
      requiere2FA: false,
      token,
      usuario,
    });
  } catch (error) {
    console.error("Error al iniciar sesión:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo iniciar sesión",
    });
  }
}

export async function verificarSegundoPaso(
  req: Request,
  res: Response
): Promise<void> {
  const desafioToken = String(
    req.body?.desafioToken ?? ""
  );

  const codigoIngresado = String(
    req.body?.codigo ?? ""
  );

  const confiarDispositivo =
    req.body?.confiarDispositivo === true;

  if (!desafioToken || !codigoIngresado) {
    res.status(400).json({
      ok: false,
      mensaje: "Código y desafío son obligatorios",
    });
    return;
  }

  try {
    const desafio =
      verificarTokenDesafio2FA(desafioToken);

    const [usuarios] = await pool.query<UsuarioRow[]>(
      `
        SELECT
          id,
          nombre,
          apellido,
          correo,
          telefono,
          foto_url,
          activo
        FROM usuarios
        WHERE id = ?
          AND activo = 1
        LIMIT 1
      `,
      [desafio.usuarioId]
    );

    const usuarioDb = usuarios[0];

    if (!usuarioDb) {
      res.status(404).json({
        ok: false,
        mensaje: "Usuario no encontrado",
      });
      return;
    }

    const [configuraciones] =
      await pool.query<Configuracion2FAAuthRow[]>(
        `
          SELECT
            secreto_cifrado,
            activo,
            codigos_recuperacion
          FROM configuracion_2fa
          WHERE usuario_id = ?
          LIMIT 1
        `,
        [desafio.usuarioId]
      );

    const configuracion = configuraciones[0];

    if (
      !configuracion?.activo ||
      !configuracion.secreto_cifrado
    ) {
      res.status(400).json({
        ok: false,
        mensaje: "La verificación en 2 pasos no está activa",
      });
      return;
    }

    const codigo = limpiarCodigo2FA(codigoIngresado);
    const secreto = descifrarSecreto(
      configuracion.secreto_cifrado
    );

    let valido = false;
    let hashesRestantes: string[] | null = null;

    if (/^\d{6}$/.test(codigo)) {
      const resultado = await verificarTotp({
        secret: secreto,
        token: codigo,
      });

      valido = resultado.valid;
    }

    if (!valido && configuracion.codigos_recuperacion) {
      const hashes = JSON.parse(
        configuracion.codigos_recuperacion
      ) as string[];

      const recuperacion =
        await consumirCodigoRecuperacion(
          codigo,
          hashes
        );

      valido = recuperacion.valido;
      hashesRestantes =
        recuperacion.hashesRestantes;
    }

    if (!valido) {
      res.status(401).json({
        ok: false,
        mensaje: "El código de verificación no es válido",
      });
      return;
    }

    if (hashesRestantes) {
      await pool.query<ResultSetHeader>(
        `
          UPDATE configuracion_2fa
          SET
            codigos_recuperacion = ?,
            ultimo_uso_en = CURRENT_TIMESTAMP,
            actualizado_en = CURRENT_TIMESTAMP
          WHERE usuario_id = ?
        `,
        [
          JSON.stringify(hashesRestantes),
          desafio.usuarioId,
        ]
      );
    } else {
      await pool.query<ResultSetHeader>(
        `
          UPDATE configuracion_2fa
          SET
            ultimo_uso_en = CURRENT_TIMESTAMP,
            actualizado_en = CURRENT_TIMESTAMP
          WHERE usuario_id = ?
        `,
        [desafio.usuarioId]
      );
    }

    if (
      confiarDispositivo &&
      desafio.dispositivoId
    ) {
      await pool.query<ResultSetHeader>(
        `
          UPDATE dispositivos_confianza
          SET
            confiable = 1,
            actualizado_en = CURRENT_TIMESTAMP
          WHERE usuario_id = ?
            AND dispositivo_id = ?
        `,
        [
          desafio.usuarioId,
          desafio.dispositivoId,
        ]
      );
    }

    await registrarAcceso(desafio.usuarioId, {
      ip: desafio.ip,
      navegador: desafio.navegador,
      sistemaOperativo:
        desafio.sistemaOperativo,
      nombreDispositivo:
        desafio.nombreDispositivo,
    });

    await registrarInicioSesionGamificacion(
      desafio.usuarioId
    );

    const usuario = {
      id: usuarioDb.id,
      nombre: usuarioDb.nombre,
      apellido: usuarioDb.apellido,
      correo: usuarioDb.correo,
      telefono: usuarioDb.telefono,
      fotoUrl: usuarioDb.foto_url,
    };

    const token = crearToken({
      id: usuarioDb.id,
      nombre: usuarioDb.nombre,
      correo: usuarioDb.correo,
    });

    res.json({
      ok: true,
      mensaje: "Verificación completada",
      requiere2FA: false,
      token,
      usuario,
    });
  } catch (error) {
    console.error("Error al verificar segundo paso:", error);

    res.status(401).json({
      ok: false,
      mensaje:
        "El desafío expiró o no es válido. Inicia sesión nuevamente.",
    });
  }
}


export async function solicitarRecuperacionPassword(
  req: Request,
  res: Response
): Promise<void> {
  const correo = String(req.body?.correo ?? "")
    .trim()
    .toLowerCase();

  if (!correoValido(correo)) {
    res.status(400).json({
      ok: false,
      mensaje: "Escribe un correo electrónico válido",
    });
    return;
  }

  const respuestaGenerica = {
    ok: true,
    mensaje:
      "Si existe una cuenta con ese correo, se generó un código de recuperación.",
  };

  try {
    const [usuarios] = await pool.query<UsuarioRow[]>(
      `
        SELECT id, nombre, correo, activo
        FROM usuarios
        WHERE correo = ?
        LIMIT 1
      `,
      [correo]
    );

    const usuario = usuarios[0];

    if (!usuario || !usuario.activo) {
      res.json(respuestaGenerica);
      return;
    }

    await pool.query<ResultSetHeader>(
      `
        UPDATE recuperaciones_password
        SET utilizado = 1
        WHERE usuario_id = ?
          AND utilizado = 0
      `,
      [usuario.id]
    );

    const codigo = String(
      randomInt(100000, 1000000)
    );

    const codigoHash = await bcrypt.hash(codigo, 10);

    await pool.query<ResultSetHeader>(
      `
        INSERT INTO recuperaciones_password (
          usuario_id,
          codigo_hash,
          expira_en,
          intentos,
          utilizado
        )
        VALUES (
          ?,
          ?,
          DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE),
          0,
          0
        )
      `,
      [usuario.id, codigoHash]
    );

    try {
      await enviarCodigoRecuperacion(
        usuario.correo,
        usuario.nombre,
        codigo
      );
    } catch (errorCorreo) {
      await pool.query<ResultSetHeader>(
        `
          UPDATE recuperaciones_password
          SET utilizado = 1
          WHERE usuario_id = ?
            AND utilizado = 0
        `,
        [usuario.id]
      );

      console.error(
        "Error al enviar correo de recuperación:",
        errorCorreo
      );

      res.status(502).json({
        ok: false,
        mensaje:
          "No se pudo enviar el código por correo. Revisa la configuración de Gmail.",
      });
      return;
    }

    res.json(respuestaGenerica);
  } catch (error) {
    console.error(
      "Error al solicitar recuperación:",
      error
    );

    res.status(500).json({
      ok: false,
      mensaje:
        "No se pudo iniciar la recuperación de contraseña",
    });
  }
}

export async function verificarRecuperacionPassword(
  req: Request,
  res: Response
): Promise<void> {
  const correo = String(req.body?.correo ?? "")
    .trim()
    .toLowerCase();

  const codigo = String(req.body?.codigo ?? "")
    .replace(/\D/g, "")
    .slice(0, 6);

  if (!correoValido(correo) || codigo.length !== 6) {
    res.status(400).json({
      ok: false,
      mensaje: "Correo o código no válidos",
    });
    return;
  }

  try {
    const [usuarios] = await pool.query<UsuarioRow[]>(
      `
        SELECT id
        FROM usuarios
        WHERE correo = ?
          AND activo = 1
        LIMIT 1
      `,
      [correo]
    );

    const usuario = usuarios[0];

    if (!usuario) {
      res.status(400).json({
        ok: false,
        mensaje: "El código no es válido o ya expiró",
      });
      return;
    }

    const [recuperaciones] =
      await pool.query<RecuperacionPasswordRow[]>(
        `
          SELECT
            id,
            usuario_id,
            codigo_hash,
            expira_en,
            intentos,
            utilizado
          FROM recuperaciones_password
          WHERE usuario_id = ?
            AND utilizado = 0
            AND expira_en > CURRENT_TIMESTAMP
          ORDER BY id DESC
          LIMIT 1
        `,
        [usuario.id]
      );

    const recuperacion = recuperaciones[0];

    if (!recuperacion || recuperacion.intentos >= 5) {
      res.status(400).json({
        ok: false,
        mensaje: "El código no es válido o ya expiró",
      });
      return;
    }

    const coincide = await bcrypt.compare(
      codigo,
      recuperacion.codigo_hash
    );

    if (!coincide) {
      await pool.query<ResultSetHeader>(
        `
          UPDATE recuperaciones_password
          SET intentos = intentos + 1
          WHERE id = ?
        `,
        [recuperacion.id]
      );

      res.status(400).json({
        ok: false,
        mensaje: "El código no es válido o ya expiró",
      });
      return;
    }

    const tokenRecuperacion = jwt.sign(
      {
        tipo: "recuperacion_password",
        usuarioId: usuario.id,
        recuperacionId: recuperacion.id,
      },
      process.env.JWT_SECRET as string,
      { expiresIn: "10m" }
    );

    res.json({
      ok: true,
      mensaje: "Código verificado",
      tokenRecuperacion,
    });
  } catch (error) {
    console.error(
      "Error al verificar recuperación:",
      error
    );

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo verificar el código",
    });
  }
}

export async function restablecerPassword(
  req: Request,
  res: Response
): Promise<void> {
  const tokenRecuperacion = String(
    req.body?.tokenRecuperacion ?? ""
  );

  const nuevaPassword = String(
    req.body?.nuevaPassword ?? ""
  );

  if (!tokenRecuperacion || !passwordSegura(nuevaPassword)) {
    res.status(400).json({
      ok: false,
      mensaje:
        "La contraseña debe tener al menos 8 caracteres, mayúscula, minúscula y número",
    });
    return;
  }

  try {
    const payload = jwt.verify(
      tokenRecuperacion,
      process.env.JWT_SECRET as string
    ) as {
      tipo: string;
      usuarioId: number;
      recuperacionId: number;
    };

    if (payload.tipo !== "recuperacion_password") {
      throw new Error("Token inválido");
    }

    const [recuperaciones] =
      await pool.query<RecuperacionPasswordRow[]>(
        `
          SELECT id, usuario_id, utilizado, expira_en
          FROM recuperaciones_password
          WHERE id = ?
            AND usuario_id = ?
            AND utilizado = 0
            AND expira_en > CURRENT_TIMESTAMP
          LIMIT 1
        `,
        [
          payload.recuperacionId,
          payload.usuarioId,
        ]
      );

    if (!recuperaciones[0]) {
      res.status(400).json({
        ok: false,
        mensaje: "La recuperación ya expiró o fue utilizada",
      });
      return;
    }

    const passwordHash = await bcrypt.hash(
      nuevaPassword,
      12
    );

    const conexion = await pool.getConnection();

    try {
      await conexion.beginTransaction();

      await conexion.query<ResultSetHeader>(
        `
          UPDATE usuarios
          SET
            password_hash = ?,
            actualizado_en = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        [passwordHash, payload.usuarioId]
      );

      await conexion.query<ResultSetHeader>(
        `
          UPDATE recuperaciones_password
          SET utilizado = 1
          WHERE usuario_id = ?
        `,
        [payload.usuarioId]
      );

      await conexion.query<ResultSetHeader>(
        `
          UPDATE dispositivos_confianza
          SET confiable = 0
          WHERE usuario_id = ?
        `,
        [payload.usuarioId]
      );

      await conexion.commit();
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }

    res.json({
      ok: true,
      mensaje:
        "Contraseña actualizada. Inicia sesión nuevamente.",
    });
  } catch (error) {
    console.error(
      "Error al restablecer contraseña:",
      error
    );

    res.status(400).json({
      ok: false,
      mensaje:
        "La recuperación expiró o no es válida",
    });
  }
}

export async function obtenerPerfil(
  req: AuthRequest,
  res: Response
): Promise<void> {
  if (!req.usuario) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  try {
    const [usuarios] = await pool.query<UsuarioRow[]>(
      `
        SELECT
          id,
          nombre,
          apellido,
          correo,
          telefono,
          foto_url,
          activo,
          correo_verificado,
          ultimo_acceso
        FROM usuarios
        WHERE id = ?
        LIMIT 1
      `,
      [req.usuario.id]
    );

    if (usuarios.length === 0) {
      res.status(404).json({
        ok: false,
        mensaje: "Usuario no encontrado",
      });
      return;
    }

    const usuario = usuarios[0];

    res.json({
      ok: true,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        correo: usuario.correo,
        telefono: usuario.telefono,
        fotoUrl: usuario.foto_url,
        correoVerificado: Boolean(usuario.correo_verificado),
        ultimoAcceso: usuario.ultimo_acceso,
      },
    });
  } catch (error) {
    console.error("Error al obtener perfil:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo obtener el perfil",
    });
  }
}