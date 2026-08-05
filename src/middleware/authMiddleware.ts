import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { JwtPayloadUsuario } from "../types/auth";

export interface AuthRequest extends Request {
  usuario?: {
    id: number;
    nombre: string;
    correo: string;
  };
}

export function verificarToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    res.status(401).json({
      ok: false,
      mensaje: "Token de acceso no proporcionado",
    });
    return;
  }

  const token = authorization.substring(7);

  try {
    const secreto = process.env.JWT_SECRET;

    if (!secreto) {
      throw new Error("JWT_SECRET no está configurado");
    }

    const payload = jwt.verify(token, secreto) as JwtPayloadUsuario;

    req.usuario = payload.usuario;
    next();
  } catch {
    res.status(401).json({
      ok: false,
      mensaje: "Token inválido o vencido",
    });
  }
}