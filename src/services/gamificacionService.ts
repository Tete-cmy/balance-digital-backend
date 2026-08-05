
import type {
  ResultSetHeader,
  RowDataPacket,
} from "mysql2";

import { pool } from "../config/database";
import type {
  AparienciaGamificacion,
  CategoriaGamificacion,
  LogroGamificacion,
  RegistrarEventoGamificacion,
  ResumenGamificacion,
  TipoEventoGamificacion,
} from "../types/gamificacion";

interface PerfilFila extends RowDataPacket {
  usuario_id: number;
  nombre_mascota: string;
  xp_total: number;
  xp_disponible: number;
  nivel_actual: number;
  racha_actual: number;
  mejor_racha: number;
  ultima_actividad_fecha: string | Date | null;
  apariencia_activa_id: number | null;
}

interface AparienciaFila extends RowDataPacket {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: CategoriaGamificacion;
  costo_xp: number;
  archivo_imagen: string;
  desbloqueada: number;
  equipada: number;
}

interface LogroFila extends RowDataPacket {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: Exclude<CategoriaGamificacion, "GRATIS">;
  tipo_objetivo:
    | "EVENTO_UNICO"
    | "CANTIDAD_EVENTOS"
    | "RACHA"
    | "XP_TOTAL"
    | "NIVEL"
    | "PERFIL";
  evento_objetivo: string | null;
  valor_objetivo: number;
  xp_recompensa: number;
  icono: string;
  progreso_actual: number;
  completado: number;
  completado_en: string | Date | null;
  recompensa_entregada: number;
}

interface ConteoFila extends RowDataPacket {
  total: number;
}

interface ActividadFila extends RowDataPacket {
  fecha: string | Date;
}

const XP_POR_EVENTO: Record<TipoEventoGamificacion, number> = {
  INICIO_SESION: 5,
  PERFIL_COMPLETADO: 25,
  INGRESO_REGISTRADO: 15,
  GASTO_REGISTRADO: 10,
  PRESUPUESTO_CREADO: 20,
  PRESUPUESTO_ACTUALIZADO: 8,
  META_CREADA: 20,
  APORTE_META: 12,
  REPORTE_CONSULTADO: 5,
  OTRO: 0,
};

const EVENTOS_VALIDOS_PARA_RACHA =
  new Set<TipoEventoGamificacion>([
    "INICIO_SESION",
  ]);

function fechaMysql(valor: string | Date | null): string | null {
  if (!valor) return null;

  if (typeof valor === "string") {
    return valor.slice(0, 10);
  }

  return valor.toISOString().slice(0, 10);
}

function fechaLocal(fecha = new Date()): string {
  const anio = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const dia = String(fecha.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
}

function sumarDias(fechaTexto: string, dias: number): string {
  const [anio, mes, dia] = fechaTexto
    .split("-")
    .map(Number);

  const fecha = new Date(anio, mes - 1, dia);
  fecha.setDate(fecha.getDate() + dias);
  return fechaLocal(fecha);
}

function diferenciaDias(
  fechaAnterior: string,
  fechaActual: string
): number {
  const anterior = new Date(`${fechaAnterior}T00:00:00`);
  const actual = new Date(`${fechaActual}T00:00:00`);

  return Math.round(
    (actual.getTime() - anterior.getTime()) /
      86_400_000
  );
}

function calcularNivel(xpTotal: number): {
  nivel: number;
  xpInicioNivel: number;
  xpSiguienteNivel: number;
  xpDentroNivel: number;
  progreso: number;
} {
  let nivel = 1;
  let xpInicioNivel = 0;
  let costoNivel = 100;

  while (xpTotal >= xpInicioNivel + costoNivel) {
    xpInicioNivel += costoNivel;
    nivel += 1;
    costoNivel = nivel * 100;
  }

  const xpDentroNivel = xpTotal - xpInicioNivel;
  const progreso = Math.min(
    100,
    Math.round((xpDentroNivel / costoNivel) * 100)
  );

  return {
    nivel,
    xpInicioNivel,
    xpSiguienteNivel: costoNivel,
    xpDentroNivel,
    progreso,
  };
}

async function asegurarPerfil(
  usuarioId: number
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `
      INSERT INTO gamificacion_perfil (
        usuario_id,
        xp_total,
        xp_disponible
      )
      VALUES (?, 0, 0)
      ON DUPLICATE KEY UPDATE
        usuario_id = VALUES(usuario_id)
    `,
    [usuarioId]
  );

  const [apariencias] = await pool.query<RowDataPacket[]>(
    `
      SELECT id
      FROM gamificacion_apariencias
      WHERE codigo = 'ORIGINAL'
        AND activa = 1
      LIMIT 1
    `
  );

  const aparienciaOriginalId = Number(
    apariencias[0]?.id ?? 0
  );

  if (aparienciaOriginalId > 0) {
    await pool.query<ResultSetHeader>(
      `
        INSERT INTO gamificacion_usuario_apariencias (
          usuario_id,
          apariencia_id,
          equipada
        )
        VALUES (?, ?, 1)
        ON DUPLICATE KEY UPDATE
          usuario_id = VALUES(usuario_id)
      `,
      [usuarioId, aparienciaOriginalId]
    );

    await pool.query<ResultSetHeader>(
      `
        UPDATE gamificacion_perfil
        SET apariencia_activa_id =
          COALESCE(apariencia_activa_id, ?)
        WHERE usuario_id = ?
      `,
      [aparienciaOriginalId, usuarioId]
    );
  }

  await pool.query<ResultSetHeader>(
    `
      INSERT INTO gamificacion_usuario_logros (
        usuario_id,
        logro_id
      )
      SELECT ?, id
      FROM gamificacion_logros_catalogo
      WHERE activo = 1
      ON DUPLICATE KEY UPDATE
        usuario_id = VALUES(usuario_id)
    `,
    [usuarioId]
  );
}

async function obtenerPerfil(
  usuarioId: number
): Promise<PerfilFila> {
  await asegurarPerfil(usuarioId);

  const [filas] = await pool.query<PerfilFila[]>(
    `
      SELECT
        usuario_id,
        nombre_mascota,
        xp_total,
        xp_disponible,
        nivel_actual,
        racha_actual,
        mejor_racha,
        ultima_actividad_fecha,
        apariencia_activa_id
      FROM gamificacion_perfil
      WHERE usuario_id = ?
      LIMIT 1
    `,
    [usuarioId]
  );

  if (!filas[0]) {
    throw new Error(
      "No se pudo crear el perfil de gamificación"
    );
  }

  return filas[0];
}

async function actualizarRacha(
  usuarioId: number,
  fechaEvento: string,
  xpEvento: number
): Promise<void> {
  const perfil = await obtenerPerfil(usuarioId);
  const ultimaFecha = fechaMysql(
    perfil.ultima_actividad_fecha
  );

  let nuevaRacha = perfil.racha_actual;

  if (!ultimaFecha) {
    nuevaRacha = 1;
  } else {
    const diferencia = diferenciaDias(
      ultimaFecha,
      fechaEvento
    );

    if (diferencia === 1) {
      nuevaRacha += 1;
    } else if (diferencia > 1) {
      nuevaRacha = 1;
    }
  }

  await pool.query<ResultSetHeader>(
    `
      INSERT INTO gamificacion_actividad_diaria (
        usuario_id,
        fecha,
        acciones_validas,
        xp_ganada
      )
      VALUES (?, ?, 1, ?)
      ON DUPLICATE KEY UPDATE
        acciones_validas = acciones_validas + 1,
        xp_ganada = xp_ganada + VALUES(xp_ganada),
        ultimo_evento_en = CURRENT_TIMESTAMP
    `,
    [usuarioId, fechaEvento, xpEvento]
  );

  await pool.query<ResultSetHeader>(
    `
      UPDATE gamificacion_perfil
      SET
        racha_actual = ?,
        mejor_racha = GREATEST(mejor_racha, ?),
        ultima_actividad_fecha = ?
      WHERE usuario_id = ?
    `,
    [
      nuevaRacha,
      nuevaRacha,
      fechaEvento,
      usuarioId,
    ]
  );
}

async function contarEventos(
  usuarioId: number,
  tipoEvento: string
): Promise<number> {
  const [filas] = await pool.query<ConteoFila[]>(
    `
      SELECT COUNT(*) AS total
      FROM gamificacion_eventos
      WHERE usuario_id = ?
        AND tipo_evento = ?
    `,
    [usuarioId, tipoEvento]
  );

  return Number(filas[0]?.total ?? 0);
}

async function evaluarLogros(
  usuarioId: number
): Promise<void> {
  for (let vuelta = 0; vuelta < 2; vuelta += 1) {
    const perfil = await obtenerPerfil(usuarioId);
    const nivel = calcularNivel(perfil.xp_total).nivel;

    const [logros] = await pool.query<LogroFila[]>(
      `
        SELECT
          l.id,
          l.codigo,
          l.nombre,
          l.descripcion,
          l.categoria,
          l.tipo_objetivo,
          l.evento_objetivo,
          l.valor_objetivo,
          l.xp_recompensa,
          l.icono,
          ul.progreso_actual,
          ul.completado,
          ul.completado_en,
          ul.recompensa_entregada
        FROM gamificacion_logros_catalogo l
        INNER JOIN gamificacion_usuario_logros ul
          ON ul.logro_id = l.id
         AND ul.usuario_id = ?
        WHERE l.activo = 1
        ORDER BY l.orden_visual, l.id
      `,
      [usuarioId]
    );

    let huboRecompensa = false;

    for (const logro of logros) {
      let progreso = 0;

      if (
        logro.tipo_objetivo === "EVENTO_UNICO" ||
        logro.tipo_objetivo === "CANTIDAD_EVENTOS" ||
        logro.tipo_objetivo === "PERFIL"
      ) {
        progreso = logro.evento_objetivo
          ? await contarEventos(
              usuarioId,
              logro.evento_objetivo
            )
          : 0;
      } else if (logro.tipo_objetivo === "RACHA") {
        progreso = perfil.racha_actual;
      } else if (
        logro.tipo_objetivo === "XP_TOTAL"
      ) {
        progreso = perfil.xp_total;
      } else if (logro.tipo_objetivo === "NIVEL") {
        progreso = nivel;
      }

      progreso = Math.min(
        progreso,
        logro.valor_objetivo
      );

      const completado =
        progreso >= logro.valor_objetivo;

      await pool.query<ResultSetHeader>(
        `
          UPDATE gamificacion_usuario_logros
          SET
            progreso_actual = ?,
            completado = ?,
            completado_en =
              CASE
                WHEN ? = 1 AND completado_en IS NULL
                  THEN CURRENT_TIMESTAMP
                ELSE completado_en
              END
          WHERE usuario_id = ?
            AND logro_id = ?
        `,
        [
          progreso,
          completado ? 1 : 0,
          completado ? 1 : 0,
          usuarioId,
          logro.id,
        ]
      );

      if (
        completado &&
        !logro.recompensa_entregada &&
        logro.xp_recompensa > 0
      ) {
        const conexion = await pool.getConnection();

        try {
          await conexion.beginTransaction();

          const [resultado] =
            await conexion.query<ResultSetHeader>(
              `
                UPDATE gamificacion_usuario_logros
                SET recompensa_entregada = 1
                WHERE usuario_id = ?
                  AND logro_id = ?
                  AND recompensa_entregada = 0
              `,
              [usuarioId, logro.id]
            );

          if (resultado.affectedRows > 0) {
            await conexion.query<ResultSetHeader>(
              `
                UPDATE gamificacion_perfil
                SET
                  xp_total = xp_total + ?,
                  xp_disponible = xp_disponible + ?
                WHERE usuario_id = ?
              `,
              [
                logro.xp_recompensa,
                logro.xp_recompensa,
                usuarioId,
              ]
            );

            huboRecompensa = true;
          }

          await conexion.commit();
        } catch (error) {
          await conexion.rollback();
          throw error;
        } finally {
          conexion.release();
        }
      }
    }

    if (!huboRecompensa) {
      break;
    }
  }

  const perfilFinal = await obtenerPerfil(usuarioId);
  const nivelFinal = calcularNivel(
    perfilFinal.xp_total
  ).nivel;

  await pool.query<ResultSetHeader>(
    `
      UPDATE gamificacion_perfil
      SET nivel_actual = ?
      WHERE usuario_id = ?
    `,
    [nivelFinal, usuarioId]
  );
}

export async function registrarInicioSesionGamificacion(
  usuarioId: number
): Promise<{
  registrado: boolean;
  xpOtorgada: number;
}> {
  const fecha = fechaLocal();
  const referenciaDiaria = Number(
    fecha.replaceAll("-", "")
  );

  return registrarEventoGamificacion(
    usuarioId,
    {
      tipoEvento: "INICIO_SESION",
      referenciaId: referenciaDiaria,
      descripcion:
        "Primer inicio de sesión del día",
    }
  );
}

export async function registrarEventoGamificacion(
  usuarioId: number,
  evento: RegistrarEventoGamificacion
): Promise<{
  registrado: boolean;
  xpOtorgada: number;
}> {
  await asegurarPerfil(usuarioId);

  const xpOtorgada =
    XP_POR_EVENTO[evento.tipoEvento] ?? 0;

  if (evento.referenciaId) {
    const [duplicados] =
      await pool.query<RowDataPacket[]>(
        `
          SELECT id
          FROM gamificacion_eventos
          WHERE usuario_id = ?
            AND tipo_evento = ?
            AND referencia_id = ?
          LIMIT 1
        `,
        [
          usuarioId,
          evento.tipoEvento,
          evento.referenciaId,
        ]
      );

    if (duplicados.length > 0) {
      return {
        registrado: false,
        xpOtorgada: 0,
      };
    }
  }

  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    await conexion.query<ResultSetHeader>(
      `
        INSERT INTO gamificacion_eventos (
          usuario_id,
          tipo_evento,
          referencia_id,
          xp_otorgada,
          descripcion
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [
        usuarioId,
        evento.tipoEvento,
        evento.referenciaId ?? null,
        xpOtorgada,
        evento.descripcion?.trim().slice(0, 180) ??
          null,
      ]
    );

    if (xpOtorgada > 0) {
      await conexion.query<ResultSetHeader>(
        `
          UPDATE gamificacion_perfil
          SET
            xp_total = xp_total + ?,
            xp_disponible = xp_disponible + ?
          WHERE usuario_id = ?
        `,
        [xpOtorgada, xpOtorgada, usuarioId]
      );
    }

    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }

  if (
    EVENTOS_VALIDOS_PARA_RACHA.has(
      evento.tipoEvento
    )
  ) {
    await actualizarRacha(
      usuarioId,
      fechaLocal(),
      xpOtorgada
    );
  }

  await evaluarLogros(usuarioId);

  return {
    registrado: true,
    xpOtorgada,
  };
}

function mapearApariencia(
  fila: AparienciaFila
): AparienciaGamificacion {
  return {
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    categoria: fila.categoria,
    costoXp: fila.costo_xp,
    archivoImagen: fila.archivo_imagen,
    desbloqueada: Boolean(fila.desbloqueada),
    equipada: Boolean(fila.equipada),
  };
}

function mapearLogro(
  fila: LogroFila
): LogroGamificacion {
  return {
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    categoria: fila.categoria,
    tipoObjetivo: fila.tipo_objetivo,
    valorObjetivo: fila.valor_objetivo,
    progresoActual: fila.progreso_actual,
    xpRecompensa: fila.xp_recompensa,
    icono: fila.icono,
    completado: Boolean(fila.completado),
    completadoEn: fila.completado_en
      ? new Date(fila.completado_en).toISOString()
      : null,
  };
}

export async function obtenerResumenGamificacion(
  usuarioId: number
): Promise<ResumenGamificacion> {
  await asegurarPerfil(usuarioId);
  await evaluarLogros(usuarioId);

  const perfil = await obtenerPerfil(usuarioId);
  const nivel = calcularNivel(perfil.xp_total);

  const [aparienciasFilas] =
    await pool.query<AparienciaFila[]>(
      `
        SELECT
          a.id,
          a.codigo,
          a.nombre,
          a.descripcion,
          a.categoria,
          a.costo_xp,
          a.archivo_imagen,
          CASE
            WHEN ua.usuario_id IS NULL THEN 0
            ELSE 1
          END AS desbloqueada,
          COALESCE(ua.equipada, 0) AS equipada
        FROM gamificacion_apariencias a
        LEFT JOIN gamificacion_usuario_apariencias ua
          ON ua.apariencia_id = a.id
         AND ua.usuario_id = ?
        WHERE a.activa = 1
        ORDER BY a.orden_visual, a.id
      `,
      [usuarioId]
    );

  const [logrosFilas] =
    await pool.query<LogroFila[]>(
      `
        SELECT
          l.id,
          l.codigo,
          l.nombre,
          l.descripcion,
          l.categoria,
          l.tipo_objetivo,
          l.evento_objetivo,
          l.valor_objetivo,
          l.xp_recompensa,
          l.icono,
          ul.progreso_actual,
          ul.completado,
          ul.completado_en,
          ul.recompensa_entregada
        FROM gamificacion_logros_catalogo l
        INNER JOIN gamificacion_usuario_logros ul
          ON ul.logro_id = l.id
         AND ul.usuario_id = ?
        WHERE l.activo = 1
        ORDER BY l.orden_visual, l.id
      `,
      [usuarioId]
    );

  const hoy = fechaLocal();
  const inicioSemana = sumarDias(
    hoy,
    -((new Date().getDay() + 6) % 7)
  );
  const finSemana = sumarDias(inicioSemana, 6);

  const [actividadSemana] =
    await pool.query<ActividadFila[]>(
      `
        SELECT fecha
        FROM gamificacion_actividad_diaria
        WHERE usuario_id = ?
          AND fecha BETWEEN ? AND ?
      `,
      [usuarioId, inicioSemana, finSemana]
    );

  const fechasActivas = new Set(
    actividadSemana
      .map((fila) => fechaMysql(fila.fecha))
      .filter(
        (fecha): fecha is string => Boolean(fecha)
      )
  );

  const diasSemana = Array.from(
    { length: 7 },
    (_, indice) => {
      const fecha = sumarDias(inicioSemana, indice);

      return {
        fecha,
        activo: fechasActivas.has(fecha),
      };
    }
  );

  const apariencias =
    aparienciasFilas.map(mapearApariencia);
  const logros = logrosFilas.map(mapearLogro);
  const aparienciaActiva =
    apariencias.find(
      (apariencia) =>
        apariencia.id ===
          perfil.apariencia_activa_id ||
        apariencia.equipada
    ) ?? null;

  const ultimaActividad = fechaMysql(
    perfil.ultima_actividad_fecha
  );
  const diasSinActividad = ultimaActividad
    ? diferenciaDias(ultimaActividad, hoy)
    : null;

  const estadoAnimo:
    | "FELIZ"
    | "MOTIVADO"
    | "TRANQUILO"
    | "TRISTE" =
    perfil.racha_actual >= 7
      ? "MOTIVADO"
      : diasSinActividad === null
        ? "TRANQUILO"
        : diasSinActividad <= 1
          ? "FELIZ"
          : diasSinActividad <= 2
            ? "TRANQUILO"
            : "TRISTE";

  return {
    nombreMascota: perfil.nombre_mascota,
    xpTotal: perfil.xp_total,
    xpDisponible: perfil.xp_disponible,
    nivelActual: nivel.nivel,
    xpNivelActual: nivel.xpDentroNivel,
    xpSiguienteNivel: nivel.xpSiguienteNivel,
    progresoNivelPorcentaje: nivel.progreso,
    rachaActual: perfil.racha_actual,
    mejorRacha: perfil.mejor_racha,
    ultimaActividadFecha: ultimaActividad,
    diasSemana,
    aparienciaActiva,
    apariencias,
    logros,
    logrosCompletados: logros.filter(
      (logro) => logro.completado
    ).length,
    logrosTotales: logros.length,
    estadoAnimo,
  };
}

export async function cambiarNombreMascota(
  usuarioId: number,
  nombre: string
): Promise<void> {
  const nombreLimpio = nombre.trim();

  if (
    nombreLimpio.length < 2 ||
    nombreLimpio.length > 40
  ) {
    throw new Error(
      "El nombre debe tener entre 2 y 40 caracteres"
    );
  }

  await asegurarPerfil(usuarioId);

  await pool.query<ResultSetHeader>(
    `
      UPDATE gamificacion_perfil
      SET nombre_mascota = ?
      WHERE usuario_id = ?
    `,
    [nombreLimpio, usuarioId]
  );
}

export async function desbloquearApariencia(
  usuarioId: number,
  aparienciaId: number
): Promise<void> {
  await asegurarPerfil(usuarioId);

  const [apariencias] =
    await pool.query<AparienciaFila[]>(
      `
        SELECT
          id,
          codigo,
          nombre,
          descripcion,
          categoria,
          costo_xp,
          archivo_imagen,
          0 AS desbloqueada,
          0 AS equipada
        FROM gamificacion_apariencias
        WHERE id = ?
          AND activa = 1
        LIMIT 1
      `,
      [aparienciaId]
    );

  const apariencia = apariencias[0];

  if (!apariencia) {
    throw new Error("Apariencia no encontrada");
  }

  const [existentes] = await pool.query<RowDataPacket[]>(
    `
      SELECT apariencia_id
      FROM gamificacion_usuario_apariencias
      WHERE usuario_id = ?
        AND apariencia_id = ?
      LIMIT 1
    `,
    [usuarioId, aparienciaId]
  );

  if (existentes.length > 0) {
    return;
  }

  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    const [resultado] =
      await conexion.query<ResultSetHeader>(
        `
          UPDATE gamificacion_perfil
          SET xp_disponible =
            xp_disponible - ?
          WHERE usuario_id = ?
            AND xp_disponible >= ?
        `,
        [
          apariencia.costo_xp,
          usuarioId,
          apariencia.costo_xp,
        ]
      );

    if (resultado.affectedRows === 0) {
      throw new Error(
        "No tienes XP suficiente para desbloquearla"
      );
    }

    await conexion.query<ResultSetHeader>(
      `
        INSERT INTO gamificacion_usuario_apariencias (
          usuario_id,
          apariencia_id,
          equipada
        )
        VALUES (?, ?, 0)
      `,
      [usuarioId, aparienciaId]
    );

    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}

export async function equiparApariencia(
  usuarioId: number,
  aparienciaId: number
): Promise<void> {
  await asegurarPerfil(usuarioId);

  const [desbloqueadas] =
    await pool.query<RowDataPacket[]>(
      `
        SELECT apariencia_id
        FROM gamificacion_usuario_apariencias
        WHERE usuario_id = ?
          AND apariencia_id = ?
        LIMIT 1
      `,
      [usuarioId, aparienciaId]
    );

  if (desbloqueadas.length === 0) {
    throw new Error(
      "Primero debes desbloquear esta apariencia"
    );
  }

  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    await conexion.query<ResultSetHeader>(
      `
        UPDATE gamificacion_usuario_apariencias
        SET equipada = 0
        WHERE usuario_id = ?
      `,
      [usuarioId]
    );

    await conexion.query<ResultSetHeader>(
      `
        UPDATE gamificacion_usuario_apariencias
        SET equipada = 1
        WHERE usuario_id = ?
          AND apariencia_id = ?
      `,
      [usuarioId, aparienciaId]
    );

    await conexion.query<ResultSetHeader>(
      `
        UPDATE gamificacion_perfil
        SET apariencia_activa_id = ?
        WHERE usuario_id = ?
      `,
      [aparienciaId, usuarioId]
    );

    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}