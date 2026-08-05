import { Router } from "express";
import { obtenerReportes } from "../controllers/reportesController";
import { verificarToken } from "../middleware/authMiddleware";

const router = Router();

router.use(verificarToken);
router.get("/", obtenerReportes);

export default router;