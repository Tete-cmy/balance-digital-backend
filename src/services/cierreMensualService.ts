
import type {
  ResultSetHeader,
  RowDataPacket,
} from "mysql2";

import { pool } from "../config/database";

type ResultadoMensual =
  | "AHORRO"
  | "EQUILIBRIO"
  | "DEFICIT";

interface TotalesFila extends RowDataPacket {
  total_ingresos: string | number;
  total_gastos: string | number;
}

interface CierreFila extends RowDataPacket {
  id: number;
  usuario_id: number;
  anio: number;
  mes: number;
  total_ingresos: string | number;
  total_gastos: string | number;
  ahorro_neto: string | number;
  resultado: ResultadoMensual;
  evaluado_en: string | Date;
}

interface LogroFila extends RowDataPacket {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string;
  xp_recompensa: number;
  recompensa_entregada: number;
}

interface ConteoFila extends RowDataPacket {
  total: number;
}

interface AhorroFila extends RowDataPacket {
  ahorro_neto: string | number;
}

export interface CierreMensual {
  id: number;
  anio: number;
  mes: number;
  totalIngresos: number;
  totalGastos: number;
  ahorroNeto: number;
  resultado: ResultadoMensual;
  evaluadoEn: string;
}

export interface ResultadoEvaluacionMensual {
  cierre: CierreMensual;
  yaEvaluado: boolean;
  logrosDesbloqueados: Array<{
    codigo: string;
    nombre: string;
    descripcion: string;
    xpRecompensa: number;
  }>;
  xpGanada: number;
}

function numero(
  valor: string | number | null | undefined
): number {
  const convertido = Number(valor ?? 0);
  return Number.isFinite(convertido)
    ? convertido
    : 0;
}

function fechaIso(valor: string | Date): string {
  return valor instanceof Date
    ? valor.toISOString()
    : new Date(valor).toISOString();
}

function mapearCierre(
  fila: CierreFila
): CierreMensual {
  return {
    id: fila.id,
    anio: fila.anio,
    mes: fila.mes,
    totalIngresos: numero(fila.total_ingresos),
    totalGastos: numero(fila.total_gastos),
    ahorroNeto: numero(fila.ahorro_neto),
    resultado: fila.resultado,
    evaluadoEn: fechaIso(fila.evaluado_en),
  };
}

function validarPeriodo(
  anio: number,
  mes: number
): void {
  if (
    !Number.isInteger(anio) ||
    anio < 2000 ||
    anio > 2100 ||
    !Number.isInteger(mes) ||
    mes < 1 ||
    mes > 12
  ) {
    throw new Error("Periodo mensual inválido");
  }
}

function periodoActual(): {
  anio: number;
  mes: number;
} {
  const hoy = new Date();
  return {
    anio: hoy.getFullYear(),
    mes: hoy.getMonth() + 1,
  };
}

export function obtenerPeriodoAnterior(): {
  anio: number;
  mes: number;
} {
  const hoy = new Date();
  const anterior = new Date(
    hoy.getFullYear(),
    hoy.getMonth() - 1,
    1
  );

  return {
    anio: anterior.getFullYear(),
    mes: anterior.getMonth() + 1,
  };
}

function esPeriodoCerrado(
  anio: number,
  mes: number
): boolean {
  const actual = periodoActual();

  return (
    anio < actual.anio ||
    (anio === actual.anio && mes < actual.mes)
  );
}

async function obtenerTotalesMes(
  usuarioId: number,
  anio: number,
  mes: number
): Promise<{
  totalIngresos: number;
  totalGastos: number;
  ahorroNeto: number;
  resultado: ResultadoMensual;
}> {
  const [filas] = await pool.query<TotalesFila[]>(
    `
      SELECT
        COALESCE(SUM(CASE
          WHEN tipo = 'ingreso'
            AND estado = 'confirmado'
          THEN monto
          ELSE 0
        END), 0) AS total_ingresos,
        COALESCE(SUM(CASE
          WHEN tipo = 'gasto'
            AND estado = 'confirmado'
          THEN monto
          ELSE 0
        END), 0) AS total_gastos
      FROM movimientos
      WHERE usuario_id = ?
        AND YEAR(fecha) = ?
        AND MONTH(fecha) = ?
    `,
    [usuarioId, anio, mes]
  );

  const totalIngresos = numero(
    filas[0]?.total_ingresos
  );
  const totalGastos = numero(
    filas[0]?.total_gastos
  );
  const ahorroNeto =
    totalIngresos - totalGastos;

  const resultado: ResultadoMensual =
    ahorroNeto > 0
      ? "AHORRO"
      : ahorroNeto < 0
        ? "DEFICIT"
        : "EQUILIBRIO";

  return {
    totalIngresos,
    totalGastos,
    ahorroNeto,
    resultado,
  };
}

async function asegurarPerfilYLogros(
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

function calcularNivel(xpTotal: number): number {
  let nivel = 1;
  let xpInicioNivel = 0;
  let costoNivel = 100;

  while (xpTotal >= xpInicioNivel + costoNivel) {
    xpInicioNivel += costoNivel;
    nivel += 1;
    costoNivel = nivel * 100;
  }

  return nivel;
}

async function contarMesesConAhorro(
  usuarioId: number
): Promise<number> {
  const [filas] = await pool.query<ConteoFila[]>(
    `
      SELECT COUNT(*) AS total
      FROM cierres_mensuales
      WHERE usuario_id = ?
        AND resultado = 'AHORRO'
    `,
    [usuarioId]
  );

  return Number(filas[0]?.total ?? 0);
}

async function obtenerMejorAhorro(
  usuarioId: number
): Promise<number> {
  const [filas] = await pool.query<AhorroFila[]>(
    `
      SELECT COALESCE(MAX(ahorro_neto), 0)
        AS ahorro_neto
      FROM cierres_mensuales
      WHERE usuario_id = ?
        AND resultado = 'AHORRO'
    `,
    [usuarioId]
  );

  return numero(filas[0]?.ahorro_neto);
}

async function calcularRachaMensualAhorro(
  usuarioId: number
): Promise<number> {
  const [filas] = await pool.query<CierreFila[]>(
    `
      SELECT
        id,
        usuario_id,
        anio,
        mes,
        total_ingresos,
        total_gastos,
        ahorro_neto,
        resultado,
        evaluado_en
      FROM cierres_mensuales
      WHERE usuario_id = ?
      ORDER BY anio DESC, mes DESC
    `,
    [usuarioId]
  );

  let racha = 0;
  let periodoEsperado: Date | null = null;

  for (const fila of filas) {
    const periodo = new Date(
      fila.anio,
      fila.mes - 1,
      1
    );

    if (periodoEsperado) {
      if (
        periodo.getFullYear() !==
          periodoEsperado.getFullYear() ||
        periodo.getMonth() !==
          periodoEsperado.getMonth()
      ) {
        break;
      }
    }

    if (fila.resultado !== "AHORRO") {
      break;
    }

    racha += 1;
    periodoEsperado = new Date(
      periodo.getFullYear(),
      periodo.getMonth() - 1,
      1
    );
  }

  return racha;
}

async function desbloquearLogrosMensuales(
  usuarioId: number
): Promise<{
  logros: ResultadoEvaluacionMensual[
    "logrosDesbloqueados"
  ];
  xpGanada: number;
}> {
  await asegurarPerfilYLogros(usuarioId);

  const mesesConAhorro =
    await contarMesesConAhorro(usuarioId);
  const mejorAhorro =
    await obtenerMejorAhorro(usuarioId);
  const rachaMensual =
    await calcularRachaMensualAhorro(usuarioId);

  const codigosCumplidos = new Set<string>();

  if (mesesConAhorro >= 1) {
    codigosCumplidos.add("AHORRO_PRIMER_MES");
  }

  if (rachaMensual >= 3) {
    codigosCumplidos.add("AHORRO_3_MESES");
  }

  if (rachaMensual >= 6) {
    codigosCumplidos.add("AHORRO_6_MESES");
  }

  if (mejorAhorro >= 1000) {
    codigosCumplidos.add("AHORRO_1000");
  }

  if (mejorAhorro >= 5000) {
    codigosCumplidos.add("AHORRO_5000");
  }

  if (mejorAhorro >= 10000) {
    codigosCumplidos.add("AHORRO_10000");
  }

  if (codigosCumplidos.size === 0) {
    return { logros: [], xpGanada: 0 };
  }

  const placeholders = Array.from(
    codigosCumplidos
  ).map(() => "?").join(", ");

  const [logros] = await pool.query<LogroFila[]>(
    `
      SELECT
        l.id,
        l.codigo,
        l.nombre,
        l.descripcion,
        l.xp_recompensa,
        COALESCE(ul.recompensa_entregada, 0)
          AS recompensa_entregada
      FROM gamificacion_logros_catalogo l
      LEFT JOIN gamificacion_usuario_logros ul
        ON ul.logro_id = l.id
       AND ul.usuario_id = ?
      WHERE l.codigo IN (${placeholders})
        AND l.activo = 1
    `,
    [usuarioId, ...codigosCumplidos]
  );

  const nuevos: ResultadoEvaluacionMensual[
    "logrosDesbloqueados"
  ] = [];
  let xpGanada = 0;
  const conexion = await pool.getConnection();

  try {
    await conexion.beginTransaction();

    for (const logro of logros) {
      const [resultado] =
        await conexion.query<ResultSetHeader>(
          `
            UPDATE gamificacion_usuario_logros
            SET
              progreso_actual = 1,
              completado = 1,
              completado_en = COALESCE(
                completado_en,
                CURRENT_TIMESTAMP
              ),
              recompensa_entregada = 1
            WHERE usuario_id = ?
              AND logro_id = ?
              AND recompensa_entregada = 0
          `,
          [usuarioId, logro.id]
        );

      if (resultado.affectedRows > 0) {
        xpGanada += logro.xp_recompensa;
        nuevos.push({
          codigo: logro.codigo,
          nombre: logro.nombre,
          descripcion: logro.descripcion,
          xpRecompensa: logro.xp_recompensa,
        });
      }
    }

    if (xpGanada > 0) {
      await conexion.query<ResultSetHeader>(
        `
          UPDATE gamificacion_perfil
          SET
            xp_total = xp_total + ?,
            xp_disponible = xp_disponible + ?
          WHERE usuario_id = ?
        `,
        [xpGanada, xpGanada, usuarioId]
      );

      const [perfiles] =
        await conexion.query<RowDataPacket[]>(
          `
            SELECT xp_total
            FROM gamificacion_perfil
            WHERE usuario_id = ?
            LIMIT 1
          `,
          [usuarioId]
        );

      const nivel = calcularNivel(
        numero(perfiles[0]?.xp_total)
      );

      await conexion.query<ResultSetHeader>(
        `
          UPDATE gamificacion_perfil
          SET nivel_actual = ?
          WHERE usuario_id = ?
        `,
        [nivel, usuarioId]
      );
    }

    await conexion.commit();
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }

  return {
    logros: nuevos,
    xpGanada,
  };
}

export async function obtenerVistaPreviaMesActual(
  usuarioId: number
): Promise<{
  anio: number;
  mes: number;
  totalIngresos: number;
  totalGastos: number;
  ahorroNeto: number;
  resultadoProvisional: ResultadoMensual;
  esProvisional: true;
}> {
  const actual = periodoActual();
  const totales = await obtenerTotalesMes(
    usuarioId,
    actual.anio,
    actual.mes
  );

  return {
    anio: actual.anio,
    mes: actual.mes,
    totalIngresos: totales.totalIngresos,
    totalGastos: totales.totalGastos,
    ahorroNeto: totales.ahorroNeto,
    resultadoProvisional: totales.resultado,
    esProvisional: true,
  };
}

export async function listarCierresMensuales(
  usuarioId: number
): Promise<CierreMensual[]> {
  const [filas] = await pool.query<CierreFila[]>(
    `
      SELECT
        id,
        usuario_id,
        anio,
        mes,
        total_ingresos,
        total_gastos,
        ahorro_neto,
        resultado,
        evaluado_en
      FROM cierres_mensuales
      WHERE usuario_id = ?
      ORDER BY anio DESC, mes DESC
      LIMIT 36
    `,
    [usuarioId]
  );

  return filas.map(mapearCierre);
}

export async function evaluarCierreMensual(
  usuarioId: number,
  anio: number,
  mes: number
): Promise<ResultadoEvaluacionMensual> {
  validarPeriodo(anio, mes);

  if (!esPeriodoCerrado(anio, mes)) {
    throw new Error(
      "El mes todavía no termina. El resultado sigue siendo provisional."
    );
  }

  const [existentes] =
    await pool.query<CierreFila[]>(
      `
        SELECT
          id,
          usuario_id,
          anio,
          mes,
          total_ingresos,
          total_gastos,
          ahorro_neto,
          resultado,
          evaluado_en
        FROM cierres_mensuales
        WHERE usuario_id = ?
          AND anio = ?
          AND mes = ?
        LIMIT 1
      `,
      [usuarioId, anio, mes]
    );

  if (existentes[0]) {
    return {
      cierre: mapearCierre(existentes[0]),
      yaEvaluado: true,
      logrosDesbloqueados: [],
      xpGanada: 0,
    };
  }

  const totales = await obtenerTotalesMes(
    usuarioId,
    anio,
    mes
  );

  const [resultadoInsert] =
    await pool.query<ResultSetHeader>(
      `
        INSERT INTO cierres_mensuales (
          usuario_id,
          anio,
          mes,
          total_ingresos,
          total_gastos,
          ahorro_neto,
          resultado
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        usuarioId,
        anio,
        mes,
        totales.totalIngresos,
        totales.totalGastos,
        totales.ahorroNeto,
        totales.resultado,
      ]
    );

  const [filasCierre] =
    await pool.query<CierreFila[]>(
      `
        SELECT
          id,
          usuario_id,
          anio,
          mes,
          total_ingresos,
          total_gastos,
          ahorro_neto,
          resultado,
          evaluado_en
        FROM cierres_mensuales
        WHERE id = ?
        LIMIT 1
      `,
      [resultadoInsert.insertId]
    );

  const cierre = filasCierre[0];

  if (!cierre) {
    throw new Error(
      "No se pudo recuperar el cierre mensual"
    );
  }

  const recompensas =
    await desbloquearLogrosMensuales(usuarioId);

  return {
    cierre: mapearCierre(cierre),
    yaEvaluado: false,
    logrosDesbloqueados: recompensas.logros,
    xpGanada: recompensas.xpGanada,
  };
}

export async function evaluarMesAnteriorPendiente(
  usuarioId: number
): Promise<ResultadoEvaluacionMensual> {
  const anterior = obtenerPeriodoAnterior();

  return evaluarCierreMensual(
    usuarioId,
    anterior.anio,
    anterior.mes
  );
}