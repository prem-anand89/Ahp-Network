// §8G4/[H1] — plain fetch to Brevo's transactional email REST API, no SDK
// (same reasoning as r2.ts's aws4fetch swap: a Workers-compatible fetch call
// needs no client library at all for a single POST endpoint). Requires a
// BREVO_API_KEY Workers Secret and a verified sending domain/sender in the
// Brevo dashboard — see the founder-facing setup note this file's call site
// links to.

export interface EmailEnv {
  BREVO_API_KEY: string;
  EMAIL_FROM_ADDRESS: string;
}

export async function sendEmailViaBrevo(env: EmailEnv, to: string, subject: string, body: string): Promise<boolean> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: env.EMAIL_FROM_ADDRESS },
      to: [{ email: to }],
      subject,
      textContent: body,
    }),
  });
  return res.ok;
}
