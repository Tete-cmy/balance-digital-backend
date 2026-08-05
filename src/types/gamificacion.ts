export type TipoEventoGamificacion =
  | "INICIO_SESION"
  | "PERFIL_COMPLETADO"
  | "INGRESO_REGISTRADO"
  | "GASTO_REGISTRADO"
  | "PRESUPUESTO_CREADO"
  | "PRESUPUESTO_ACTUALIZADO"
  | "META_CREADA"
  | "APORTE_META"
  | "REPORTE_CONSULTADO"
  | "OTRO";

export type CategoriaGamificacion =
  | "GRATIS"
  | "BRONCE"
  | "PLATA"
  | "ORO"
  | "PLATINO"
  | "DIAMANTE";

export interface RegistrarEventoGamificacion {
  tipoEvento: TipoEventoGamificacion;
  referenciaId?: number | null;
  descripcion?: string | null;
}

export interface AparienciaGamificacion {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: CategoriaGamificacion;
  costoXp: number;
  archivoImagen: string;
  desbloqueada: boolean;
  equipada: boolean;
}

export interface LogroGamificacion {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string;
  categoria: Exclude<CategoriaGamificacion, "GRATIS">;
  tipoObjetivo:
    | "EVENTO_UNICO"
    | "CANTIDAD_EVENTOS"
    | "RACHA"
    | "XP_TOTAL"
    | "NIVEL"
    | "PERFIL";
  valorObjetivo: number;
  progresoActual: number;
  xpRecompensa: number;
  icono: string;
  completado: boolean;
  completadoEn: string | null;
}

export interface ResumenGamificacion {
  nombreMascota: string;
  xpTotal: number;
  xpDisponible: number;
  nivelActual: number;
  xpNivelActual: number;
  xpSiguienteNivel: number;
  progresoNivelPorcentaje: number;
  rachaActual: number;
  mejorRacha: number;
  ultimaActividadFecha: string | null;
  diasSemana: Array<{
    fecha: string;
    activo: boolean;
  }>;
  aparienciaActiva: AparienciaGamificacion | null;
  apariencias: AparienciaGamificacion[];
  logros: LogroGamificacion[];
  logrosCompletados: number;
  logrosTotales: number;
  estadoAnimo:
    | "FELIZ"
    | "MOTIVADO"
    | "TRANQUILO"
    | "TRISTE";
}