import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";
import bcrypt from "bcryptjs";
import { verify } from "otplib";

function obtenerClaveCifrado(): Buffer {
  const valor = process.env.TOTP_ENCRYPTION_KEY;

  if (!valor) {
    throw new Error("TOTP_ENCRYPTION_KEY no está configurado");
  }

  return createHash("sha256").update(valor).digest();
}

export function cifrarSecreto(secreto: string): string {
  const iv = randomBytes(12);
  const clave = obtenerClaveCifrado();
  const cipher = createCipheriv("aes-256-gcm", clave, iv);

  const cifrado = Buffer.concat([
    cipher.update(secreto, "utf8"),
    cipher.final(),
  ]);

  const etiqueta = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    etiqueta.toString("base64"),
    cifrado.toString("base64"),
  ].join(".");
}

export function descifrarSecreto(valor: string): string {
  const [ivBase64, etiquetaBase64, cifradoBase64] =
    valor.split(".");

  if (!ivBase64 || !etiquetaBase64 || !cifradoBase64) {
    throw new Error("El secreto 2FA almacenado no es válido");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    obtenerClaveCifrado(),
    Buffer.from(ivBase64, "base64")
  );

  decipher.setAuthTag(Buffer.from(etiquetaBase64, "base64"));

  const descifrado = Buffer.concat([
    decipher.update(Buffer.from(cifradoBase64, "base64")),
    decipher.final(),
  ]);

  return descifrado.toString("utf8");
}

export function limpiarCodigo2FA(valor: unknown): string {
  return String(valor ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export async function verificarCodigoTotp(
  secreto: string,
  codigo: string
): Promise<boolean> {
  const token = limpiarCodigo2FA(codigo);

  if (!/^\d{6}$/.test(token)) {
    return false;
  }

  const resultado = await verify({
    secret: secreto,
    token,
  });

  return resultado.valid;
}

function crearCodigoRecuperacion(): string {
  const valor = randomBytes(5).toString("hex").toUpperCase();

  return `${valor.slice(0, 5)}-${valor.slice(5, 10)}`;
}

export async function crearCodigosRecuperacion(): Promise<{
  planos: string[];
  hashes: string[];
}> {
  const planos = Array.from(
    { length: 8 },
    crearCodigoRecuperacion
  );

  const hashes = await Promise.all(
    planos.map((codigo) => bcrypt.hash(codigo, 10))
  );

  return { planos, hashes };
}

export async function consumirCodigoRecuperacion(
  codigoIngresado: string,
  hashes: string[]
): Promise<{
  valido: boolean;
  hashesRestantes: string[];
}> {
  const codigoLimpio = limpiarCodigo2FA(codigoIngresado);

  const codigoConGuion =
    codigoLimpio.length === 10
      ? `${codigoLimpio.slice(0, 5)}-${codigoLimpio.slice(5)}`
      : codigoLimpio;

  for (let indice = 0; indice < hashes.length; indice += 1) {
    const coincideSinGuion = await bcrypt.compare(
      codigoLimpio,
      hashes[indice]
    );

    const coincideConGuion =
      !coincideSinGuion &&
      (await bcrypt.compare(
        codigoConGuion,
        hashes[indice]
      ));

    if (coincideSinGuion || coincideConGuion) {
      return {
        valido: true,
        hashesRestantes: hashes.filter(
          (_, posicion) => posicion !== indice
        ),
      };
    }
  }

  return {
    valido: false,
    hashesRestantes: hashes,
  };
}