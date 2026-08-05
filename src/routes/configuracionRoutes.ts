import { Router } from "express";

import {
  actualizarConfianzaDispositivo,
  actualizarCorreo,
  actualizarNombre,
  actualizarPassword,
  actualizarPreferencias,
  actualizarTelefono,
  eliminarDispositivoConfianza,
  eliminarCuenta,
  obtenerConfiguracion,
  obtenerDispositivosConfianza,
  obtenerHistorialAccesos,
} from "../controllers/configuracionController";

import {
  activar2FA,
  desactivar2FA,
  obtenerEstado2FA,
  preparar2FA,
} from "../controllers/twoFactorController";

import { verificarToken } from "../middleware/authMiddleware";

const router = Router();

router.use(verificarToken);

router.get("/", obtenerConfiguracion);
router.get("/historial-accesos", obtenerHistorialAccesos);
router.get("/dispositivos", obtenerDispositivosConfianza);

router.get("/2fa/estado", obtenerEstado2FA);
router.post("/2fa/preparar", preparar2FA);
router.post("/2fa/activar", activar2FA);
router.post("/2fa/desactivar", desactivar2FA);

router.patch(
  "/dispositivos/:dispositivoId/confianza",
  actualizarConfianzaDispositivo
);

router.delete(
  "/dispositivos/:dispositivoId",
  eliminarDispositivoConfianza
);

router.patch("/nombre", actualizarNombre);
router.patch("/correo", actualizarCorreo);
router.patch("/password", actualizarPassword);
router.patch("/telefono", actualizarTelefono);
router.patch("/preferencias", actualizarPreferencias);
router.delete("/cuenta", eliminarCuenta);

export default router;