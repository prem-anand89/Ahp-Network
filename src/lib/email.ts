// §8G4/[H1] — plain fetch to Resend's REST API, no SDK (same reasoning as
// r2.ts's aws4fetch swap: a Workers-compatible fetch call needs no client
// library at all for a single POST endpoint). Requires a RESEND_API_KEY
// Workers Secret and a verified sending domain in the Resend dashboard —
// see the founder-facing setup note this file's call site links to.

export interface EmailEnv {
  RESEND_API_KEY: string;
  EMAIL_FROM_ADDRESS: string;
}

export async function sendEmailViaResend(env: EmailEnv, to: string, subject: string, body: string): Promise<boolean> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM_ADDRESS,
      to,
      subject,
      text: body,
    }),
  });
  return res.ok;
}
