import nodemailer from "nodemailer";

function obtenerConfiguracionCorreo() {
  const host = process.env.MAIL_HOST;
  const port = Number(process.env.MAIL_PORT ?? 465);
  const secure = String(
    process.env.MAIL_SECURE ?? "true"
  ).toLowerCase() === "true";
  const user = process.env.MAIL_USER;
  const password = process.env.MAIL_PASSWORD;
  const fromName =
    process.env.MAIL_FROM_NAME ?? "Balance Digital";

  if (!host || !user || !password) {
    throw new Error(
      "Faltan variables MAIL_HOST, MAIL_USER o MAIL_PASSWORD"
    );
  }

  return {
    host,
    port,
    secure,
    user,
    password,
    fromName,
  };
}

function crearTransportador() {
  const config = obtenerConfiguracionCorreo();

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
  });
}

export async function verificarConexionCorreo(): Promise<void> {
  const transportador = crearTransportador();
  await transportador.verify();
}

export async function enviarCodigoRecuperacion(
  destinatario: string,
  nombreUsuario: string,
  codigo: string
): Promise<void> {
  const config = obtenerConfiguracionCorreo();
  const transportador = crearTransportador();

  await transportador.sendMail({
    from: `"${config.fromName}" <${config.user}>`,
    to: destinatario,
    subject: "Código para recuperar tu contraseña",
    text: [
      `Hola ${nombreUsuario || "usuario"},`,
      "",
      `Tu código de recuperación es: ${codigo}`,
      "",
      "Este código vence en 10 minutos.",
      "Si no solicitaste este cambio, ignora este correo.",
      "",
      "Balance Digital",
    ].join("\n"),
    html: `
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Recuperación de contraseña</title>
        </head>

        <body style="margin:0;padding:0;background:#f1f7f4;font-family:Arial,Helvetica,sans-serif;color:#1c2a24;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f7f4;padding:32px 16px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dfe9e4;border-radius:22px;overflow:hidden;box-shadow:0 18px 45px rgba(36,75,57,0.12);">
                  <tr>
                    <td style="padding:30px 32px;background:linear-gradient(135deg,#245843,#32b879);color:#ffffff;">
                      <div style="font-size:12px;font-weight:700;letter-spacing:1.2px;opacity:0.8;">BALANCE DIGITAL</div>
                      <h1 style="margin:10px 0 0;font-size:26px;line-height:1.2;">Recupera tu acceso</h1>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:34px 32px;">
                      <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
                        Hola <strong>${nombreUsuario || "usuario"}</strong>,
                      </p>

                      <p style="margin:0 0 22px;color:#63716a;font-size:14px;line-height:1.7;">
                        Recibimos una solicitud para cambiar la contraseña de tu cuenta.
                        Usa este código para continuar:
                      </p>

                      <div style="margin:0 auto 22px;padding:18px 20px;border:1px solid #cce9dc;border-radius:16px;background:#eef9f4;text-align:center;">
                        <div style="margin-bottom:7px;color:#5b7467;font-size:10px;font-weight:700;letter-spacing:1.3px;">
                          CÓDIGO DE SEGURIDAD
                        </div>

                        <div style="color:#219863;font-size:34px;font-weight:800;letter-spacing:9px;">
                          ${codigo}
                        </div>
                      </div>

                      <p style="margin:0;color:#708078;font-size:13px;line-height:1.65;">
                        El código vence en <strong>10 minutos</strong> y solamente puede utilizarse una vez.
                      </p>

                      <div style="height:1px;margin:26px 0;background:#e8efeb;"></div>

                      <p style="margin:0;color:#8b9791;font-size:12px;line-height:1.6;">
                        Si no solicitaste este cambio, puedes ignorar este correo.
                        Tu contraseña seguirá siendo la misma.
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:18px 32px;background:#f8fbf9;color:#8b9791;font-size:11px;text-align:center;">
                      Este mensaje fue enviado automáticamente por Balance Digital.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
  });
}


export async function enviarCodigoVerificacionCorreo(
  destinatario: string,
  nombreUsuario: string,
  codigo: string
): Promise<void> {
  const config = obtenerConfiguracionCorreo();
  const transportador = crearTransportador();

  await transportador.sendMail({
    from: `"${config.fromName}" <${config.user}>`,
    to: destinatario,
    subject: "Verifica tu correo en Balance Digital",
    text: [
      `Hola ${nombreUsuario || "usuario"},`,
      "",
      `Tu código de verificación es: ${codigo}`,
      "",
      "Este código vence en 10 minutos.",
      "Si no creaste esta cuenta, ignora este correo.",
      "",
      "Balance Digital",
    ].join("\n"),
    html: `
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Verifica tu correo</title>
        </head>

        <body style="margin:0;padding:0;background:#f1f7f4;font-family:Arial,Helvetica,sans-serif;color:#1c2a24;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f7f4;padding:32px 16px;">
            <tr>
              <td align="center">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dfe9e4;border-radius:22px;overflow:hidden;box-shadow:0 18px 45px rgba(36,75,57,0.12);">
                  <tr>
                    <td style="padding:30px 32px;background:linear-gradient(135deg,#245843,#32b879);color:#ffffff;">
                      <div style="font-size:12px;font-weight:700;letter-spacing:1.2px;opacity:0.8;">BALANCE DIGITAL</div>
                      <h1 style="margin:10px 0 0;font-size:26px;line-height:1.2;">Confirma tu correo</h1>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:34px 32px;">
                      <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">
                        Hola <strong>${nombreUsuario || "usuario"}</strong>,
                      </p>

                      <p style="margin:0 0 22px;color:#63716a;font-size:14px;line-height:1.7;">
                        Gracias por crear tu cuenta. Usa este código para verificar tu correo y activar tu acceso:
                      </p>

                      <div style="margin:0 auto 22px;padding:18px 20px;border:1px solid #cce9dc;border-radius:16px;background:#eef9f4;text-align:center;">
                        <div style="margin-bottom:7px;color:#5b7467;font-size:10px;font-weight:700;letter-spacing:1.3px;">
                          CÓDIGO DE VERIFICACIÓN
                        </div>

                        <div style="color:#219863;font-size:34px;font-weight:800;letter-spacing:9px;">
                          ${codigo}
                        </div>
                      </div>

                      <p style="margin:0;color:#708078;font-size:13px;line-height:1.65;">
                        El código vence en <strong>10 minutos</strong> y solamente puede utilizarse una vez.
                      </p>

                      <div style="height:1px;margin:26px 0;background:#e8efeb;"></div>

                      <p style="margin:0;color:#8b9791;font-size:12px;line-height:1.6;">
                        Si no creaste esta cuenta, puedes ignorar este correo.
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:18px 32px;background:#f8fbf9;color:#8b9791;font-size:11px;text-align:center;">
                      Este mensaje fue enviado automáticamente por Balance Digital.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
  });
}