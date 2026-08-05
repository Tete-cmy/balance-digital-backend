import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import { probarConexion } from "./config/database";

import authRoutes from "./routes/authRoutes";
import cierreMensualRoutes from "./routes/cierreMensualRoutes";
import configuracionRoutes from "./routes/configuracionRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";
import gamificacionRoutes from "./routes/gamificacionRoutes";
import metasRoutes from "./routes/metasRoutes";
import movimientosRoutes from "./routes/movimientosRoutes";
import notificacionesRoutes from "./routes/notificacionesRoutes";
import presupuestosRoutes from "./routes/presupuestosRoutes";
import reportesRoutes from "./routes/reportesRoutes";

dotenv.config();

const app = express();

const port = Number(process.env.PORT || 4000);

const frontendUrl =
  process.env.FRONTEND_URL ||
  "http://localhost:5173";

app.use(
  cors({
    origin: frontendUrl,
    credentials: true,
  })
);

app.use(express.json({ limit: "2mb" }));

app.use(
  express.urlencoded({
    extended: true,
  })
);

app.get("/api/salud", (_req, res) => {
  res.json({
    ok: true,
    mensaje:
      "Backend de Balance Digital funcionando",
  });
});

app.use("/api/auth", authRoutes);

app.use(
  "/api/cierre-mensual",
  cierreMensualRoutes
);

app.use(
  "/api/configuracion",
  configuracionRoutes
);

app.use(
  "/api/dashboard",
  dashboardRoutes
);

app.use(
  "/api/gamificacion",
  gamificacionRoutes
);

app.use(
  "/api/metas",
  metasRoutes
);

app.use(
  "/api/movimientos",
  movimientosRoutes
);

app.use(
  "/api/notificaciones",
  notificacionesRoutes
);

app.use(
  "/api/presupuestos",
  presupuestosRoutes
);

app.use(
  "/api/reportes",
  reportesRoutes
);

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    mensaje: "Ruta no encontrada",
  });
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(
      "Error no controlado:",
      error
    );

    if (res.headersSent) {
      return;
    }

    res.status(500).json({
      ok: false,
      mensaje:
        "Ocurrió un error interno en el servidor",
    });
  }
);

async function iniciarServidor(): Promise<void> {
  try {
    await probarConexion();

    app.listen(
      port,
      "0.0.0.0",
      () => {
        console.log(
          `🚀 Servidor activo en el puerto ${port}`
        );

        console.log(
          `🌐 Frontend permitido: ${frontendUrl}`
        );
      }
    );
  } catch (error) {
    console.error(
      "❌ No se pudo iniciar el servidor:",
      error
    );

    process.exit(1);
  }
}

void iniciarServidor();