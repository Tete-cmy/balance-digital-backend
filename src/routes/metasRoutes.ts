import { Router } from "express";
import {
  abonarMeta,
  crearMeta,
  obtenerMetas,
} from "../controllers/metasController";
import { verificarToken } from "../middleware/authMiddleware";

const router = Router();

router.use(verificarToken);

router.get("/", obtenerMetas);
router.post("/", crearMeta);
router.post("/:id/abonos", abonarMeta);

export default router;