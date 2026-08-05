export interface UsuarioToken {
  id: number;
  nombre: string;
  correo: string;
}

export interface JwtPayloadUsuario {
  usuario: UsuarioToken;
  iat?: number;
  exp?: number;
}