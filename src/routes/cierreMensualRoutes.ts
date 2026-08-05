import { Router } from "express";

import {
  evaluarPeriodoMensual,
  obtenerResumenCierreMensual,
} from "../controllers/cierreMensualController";
import { verificarToken } from "../middleware/authMiddleware";

const router = Router();

router.use(verificarToken);

router.get("/", obtenerResumenCierreMensual);
router.post("/evaluar", evaluarPeriodoMensual);

export default router;