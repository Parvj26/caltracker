import nodemailer from 'nodemailer';

export interface Mailer {
  send(msg: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void>;
}

export function createMailer(env: {
  get(key: string): string | undefined;
}): Mailer {
  const from =
    env.get('INVITE_FROM_EMAIL') ?? 'CalTracker <invites@caltracker.app>';
  const resendKey = env.get('RESEND_API_KEY');

  if (resendKey) {
    return {
      async send(msg) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${resendKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ from, ...msg }),
        });
        if (!res.ok) throw new Error(`Resend responded ${res.status}`);
        await res.body?.cancel();
      },
    };
  }

  // Local development: Supabase's mail catcher.
  const transport = nodemailer.createTransport({
    host: env.get('SMTP_HOST') ?? 'host.docker.internal',
    port: Number(env.get('SMTP_PORT') ?? '54325'),
    secure: false,
    ignoreTLS: true,
  });
  return {
    async send(msg) {
      await transport.sendMail({ from, ...msg });
    },
  };
}
