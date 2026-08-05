import { Router } from "express";

import {
  eliminarNotificacion,
  listarNotificaciones,
  marcarNotificacionLeida,
  marcarTodasLeidas,
  obtenerConteoNoLeidas,
} from "../controllers/notificacionesController";
import { verificarToken } from "../middleware/authMiddleware";

const router = Router();

router.use(verificarToken);

router.get("/", listarNotificaciones);
router.get(
  "/conteo-no-leidas",
  obtenerConteoNoLeidas
);
router.patch(
  "/leer-todas",
  marcarTodasLeidas
);
router.patch(
  "/:id/leer",
  marcarNotificacionLeida
);
router.delete(
  "/:id",
  eliminarNotificacion
);

export default router;