import { Router } from "express";

import {
  actualizarNombreMascota,
  comprarApariencia,
  obtenerGamificacion,
  registrarEvento,
  seleccionarApariencia,
} from "../controllers/gamificacionController";
import { verificarToken } from "../middleware/authMiddleware";

const router = Router();

router.use(verificarToken);

router.get("/", obtenerGamificacion);
router.post("/eventos", registrarEvento);
router.patch("/mascota/nombre", actualizarNombreMascota);
router.post(
  "/apariencias/:aparienciaId/desbloquear",
  comprarApariencia
);
router.patch(
  "/apariencias/:aparienciaId/equipar",
  seleccionarApariencia
);

export default router;