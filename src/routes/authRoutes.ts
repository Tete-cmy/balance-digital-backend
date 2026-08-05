import { Router } from "express";

import {
  iniciarSesion,
  obtenerPerfil,
  reenviarCodigoVerificacion,
  registrarUsuario,
  restablecerPassword,
  solicitarRecuperacionPassword,
  verificarCorreoRegistro,
  verificarRecuperacionPassword,
  verificarSegundoPaso,
} from "../controllers/authController";
import { verificarToken } from "../middleware/authMiddleware";

const router = Router();

router.post("/registro", registrarUsuario);
router.post("/registro/verificar-correo", verificarCorreoRegistro);
router.post("/registro/reenviar-codigo", reenviarCodigoVerificacion);

router.post("/login", iniciarSesion);
router.post("/verificar-2fa", verificarSegundoPaso);

router.post(
  "/recuperar-password/solicitar",
  solicitarRecuperacionPassword
);

router.post(
  "/recuperar-password/verificar",
  verificarRecuperacionPassword
);

router.post(
  "/recuperar-password/restablecer",
  restablecerPassword
);

router.get("/perfil", verificarToken, obtenerPerfil);

export default router;