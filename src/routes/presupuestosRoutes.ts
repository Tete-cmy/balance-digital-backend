import { Router } from "express";
import {
  eliminarPresupuesto,
  guardarPresupuesto,
  obtenerCategoriasPresupuesto,
  obtenerPresupuestos,
} from "../controllers/presupuestosController";
import { verificarToken } from "../middleware/authMiddleware";

const router = Router();

router.use(verificarToken);

router.get("/", obtenerPresupuestos);
router.get("/categorias", obtenerCategoriasPresupuesto);
router.post("/", guardarPresupuesto);
router.delete("/:id", eliminarPresupuesto);

export default router;