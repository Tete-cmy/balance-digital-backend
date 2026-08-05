import type { Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../config/database";
import type { AuthRequest } from "../middleware/authMiddleware";

interface MetaFila extends RowDataPacket {
  id: number;
  nombre: string;
  descripcion: string | null;
  monto_objetivo: string | number;
  fecha_inicio: string;
  fecha_objetivo: string | null;
  icono: string | null;
  color: string;
  estado: "activa" | "completada" | "pausada" | "cancelada";
  completada_en: string | null;
  creado_en: string;
  ahorrado: string | number;
}

interface MetaExistenteFila extends RowDataPacket {
  id: number;
  monto_objetivo: string | number;
  estado: "activa" | "completada" | "pausada" | "cancelada";
  ahorrado: string | number;
}

function numero(valor: string | number | null | undefined): number {
  const convertido = Number(valor ?? 0);
  return Number.isFinite(convertido) ? convertido : 0;
}

function fechaMysqlActual(): string {
  const ahora = new Date();
  const diferenciaZona = ahora.getTimezoneOffset() * 60_000;
  return new Date(ahora.getTime() - diferenciaZona)
    .toISOString()
    .slice(0, 10);
}

export async function obtenerMetas(
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
    /*
      Se usa una subconsulta para calcular los abonos.
      Así evitamos errores de GROUP BY / ONLY_FULL_GROUP_BY en MySQL.
    */
    const [filas] = await pool.query<MetaFila[]>(
      `
        SELECT
          m.id,
          m.nombre,
          m.descripcion,
          m.monto_objetivo,
          DATE_FORMAT(m.fecha_inicio, '%Y-%m-%d') AS fecha_inicio,
          CASE
            WHEN m.fecha_objetivo IS NULL THEN NULL
            ELSE DATE_FORMAT(m.fecha_objetivo, '%Y-%m-%d')
          END AS fecha_objetivo,
          m.icono,
          m.color,
          m.estado,
          CASE
            WHEN m.completada_en IS NULL THEN NULL
            ELSE DATE_FORMAT(m.completada_en, '%Y-%m-%d %H:%i:%s')
          END AS completada_en,
          COALESCE(
            (
              SELECT SUM(a.monto)
              FROM abonos_metas a
              WHERE a.meta_id = m.id
                AND a.usuario_id = m.usuario_id
            ),
            0
          ) AS ahorrado
        FROM metas_ahorro m
        WHERE m.usuario_id = ?
          AND m.estado IN ('activa', 'completada')
         ORDER BY
        CASE WHEN m.estado = 'activa' THEN 0 ELSE 1 END,
        m.id DESC
      `,
      [usuarioId]
    );

    const metas = filas.map((fila) => {
      const objetivo = numero(fila.monto_objetivo);
      const ahorrado = numero(fila.ahorrado);
      const porcentaje =
        objetivo > 0 ? Math.min((ahorrado / objetivo) * 100, 100) : 0;

      return {
        id: fila.id,
        nombre: fila.nombre,
        descripcion: fila.descripcion,
        montoObjetivo: objetivo,
        ahorrado,
        faltante: Math.max(objetivo - ahorrado, 0),
        porcentaje,
        fechaInicio: fila.fecha_inicio,
        fechaObjetivo: fila.fecha_objetivo,
        icono: fila.icono ?? "🎯",
        color: fila.color || "#48C58D",
        estado: fila.estado,
        completadaEn: fila.completada_en,
      };
    });

    const enProgreso = metas.filter(
      (meta) => meta.estado === "activa"
    ).length;

    const completadas = metas.filter(
      (meta) => meta.estado === "completada"
    ).length;

    const totalAhorro = metas.reduce(
      (total, meta) => total + meta.ahorrado,
      0
    );

    res.json({
      ok: true,
      resumen: {
        enProgreso,
        completadas,
        totalAhorro,
      },
      metas,
    });
  } catch (error) {
    console.error("Error al obtener metas:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudieron cargar las metas de ahorro",
    });
  }
}

export async function crearMeta(
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

  const {
    nombre,
    montoObjetivo,
    fechaObjetivo,
    icono = "🎯",
    color = "#48C58D",
  } = req.body ?? {};

  const nombreLimpio = String(nombre ?? "").trim();
  const objetivoNumero = Number(montoObjetivo);
  const fechaObjetivoLimpia =
    typeof fechaObjetivo === "string" && fechaObjetivo.trim()
      ? fechaObjetivo.trim()
      : null;

  if (!nombreLimpio) {
    res.status(400).json({
      ok: false,
      mensaje: "Escribe el nombre de la meta",
    });
    return;
  }

  if (!Number.isFinite(objetivoNumero) || objetivoNumero <= 0) {
    res.status(400).json({
      ok: false,
      mensaje: "El monto objetivo debe ser mayor a cero",
    });
    return;
  }

  try {
    const [resultado] = await pool.query<ResultSetHeader>(
      `
        INSERT INTO metas_ahorro (
          usuario_id,
          nombre,
          descripcion,
          monto_objetivo,
          fecha_inicio,
          fecha_objetivo,
          icono,
          color,
          estado
        )
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'activa')
      `,
      [
        usuarioId,
        nombreLimpio,
        objetivoNumero,
        fechaMysqlActual(),
        fechaObjetivoLimpia,
        String(icono || "🎯"),
        String(color || "#48C58D"),
      ]
    );

    res.status(201).json({
      ok: true,
      mensaje: "Meta creada correctamente",
      metaId: resultado.insertId,
    });
  } catch (error) {
    console.error("Error al crear meta:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo crear la meta",
    });
  }
}

export async function abonarMeta(
  req: AuthRequest,
  res: Response
): Promise<void> {
  const usuarioId = req.usuario?.id;
  const metaId = Number(req.params.id);
  const montoSolicitado = Number(req.body?.monto);

  if (!usuarioId) {
    res.status(401).json({
      ok: false,
      mensaje: "Usuario no autenticado",
    });
    return;
  }

  if (!Number.isInteger(metaId) || metaId <= 0) {
    res.status(400).json({
      ok: false,
      mensaje: "Meta inválida",
    });
    return;
  }

  if (!Number.isFinite(montoSolicitado) || montoSolicitado <= 0) {
    res.status(400).json({
      ok: false,
      mensaje: "La cantidad a abonar debe ser mayor a cero",
    });
    return;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    /*
      Primero bloqueamos únicamente la fila de la meta.
      Después calculamos los abonos en una consulta separada.
      Esto evita problemas de FOR UPDATE con GROUP BY.
    */
    const [metas] = await connection.query<MetaExistenteFila[]>(
      `
        SELECT
          id,
          monto_objetivo,
          estado,
          0 AS ahorrado
        FROM metas_ahorro
        WHERE id = ?
          AND usuario_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [metaId, usuarioId]
    );

    const meta = metas[0];

    if (!meta) {
      await connection.rollback();

      res.status(404).json({
        ok: false,
        mensaje: "Meta no encontrada",
      });
      return;
    }

    if (meta.estado !== "activa") {
      await connection.rollback();

      res.status(400).json({
        ok: false,
        mensaje:
          meta.estado === "completada"
            ? "Esta meta ya está completada"
            : "No se puede abonar a esta meta",
      });
      return;
    }

    const [totales] = await connection.query<
      (RowDataPacket & { ahorrado: string | number })[]
    >(
      `
        SELECT COALESCE(SUM(monto), 0) AS ahorrado
        FROM abonos_metas
        WHERE meta_id = ?
          AND usuario_id = ?
      `,
      [metaId, usuarioId]
    );

    const objetivo = numero(meta.monto_objetivo);
    const ahorradoActual = numero(totales[0]?.ahorrado);
    const faltante = Math.max(objetivo - ahorradoActual, 0);

    if (faltante <= 0) {
      await connection.query<ResultSetHeader>(
        `
          UPDATE metas_ahorro
          SET
            estado = 'completada',
            completada_en = COALESCE(completada_en, NOW())
          WHERE id = ?
            AND usuario_id = ?
        `,
        [metaId, usuarioId]
      );

      await connection.commit();

      res.status(400).json({
        ok: false,
        mensaje: "Esta meta ya está completada",
      });
      return;
    }

    const montoAplicado = Math.min(montoSolicitado, faltante);

    await connection.query<ResultSetHeader>(
      `
        INSERT INTO abonos_metas (
          meta_id,
          usuario_id,
          cuenta_id,
          monto,
          fecha,
          nota
        )
        VALUES (?, ?, NULL, ?, ?, NULL)
      `,
      [
        metaId,
        usuarioId,
        montoAplicado,
        fechaMysqlActual(),
      ]
    );

    const nuevoTotal = ahorradoActual + montoAplicado;
    const metaCompletada = nuevoTotal >= objetivo;

    if (metaCompletada) {
      await connection.query<ResultSetHeader>(
        `
          UPDATE metas_ahorro
          SET
            estado = 'completada',
            completada_en = NOW()
          WHERE id = ?
            AND usuario_id = ?
        `,
        [metaId, usuarioId]
      );
    }

    await connection.commit();

    res.json({
      ok: true,
      mensaje: metaCompletada
        ? "Meta completada correctamente"
        : "Abono registrado correctamente",
      montoAplicado,
      nuevoTotal,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error al abonar meta:", error);

    res.status(500).json({
      ok: false,
      mensaje: "No se pudo registrar el abono",
    });
  } finally {
    connection.release();
  }
}