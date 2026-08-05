import { Router } from "express";
import { obtenerResumenDashboard } from "../controllers/dashboardController";
import { verificarToken } from "../middleware/authMiddleware";

const router = Router();

router.get("/resumen", verificarToken, obtenerResumenDashboard);

export default router;
