import { Router } from "express";
import {
  cambiarEstadoMovimiento,
  crearMovimiento,
  eliminarMovimiento,
  listarMovimientos,
  obtenerCategorias,
} from "../controllers/movimientosController";
import { verificarToken } from "../middleware/authMiddleware";

const router = Router();

router.use(verificarToken);

router.get("/", listarMovimientos);
router.get("/categorias", obtenerCategorias);
router.post("/", crearMovimiento);
router.patch("/:id/estado", cambiarEstadoMovimiento);
router.delete("/:id", eliminarMovimiento);

export default router;