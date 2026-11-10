// "Your coach has closed their CalTracker workspace": sent to each client after their coach's workspace is deleted
// (mockup ClientEmail.dc.html). Same plain style as the other emails (send-invite/email.ts); no button.

export interface WorkspaceClosedEmailParams {
  clientFirstName: string;
  /** Captured before the delete: the coach's profile is gone by the time this is sent. */
  coachName: string;
}

const escapeHtml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export function renderWorkspaceClosedEmail(p: WorkspaceClosedEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const coach = p.coachName.trim() || 'Your coach';
  const greeting = p.clientFirstName.trim() ? `Hi ${p.clientFirstName.trim()},` : 'Hi,';
  const subject = 'Your coach has closed their CalTracker workspace';
  const lines = [
    `${coach} has closed their coaching workspace on CalTracker, so you no longer have access to its workouts, programs, messages and community.`,
    'Your CalTracker account is still here. If you start training with another coach on CalTracker, they can invite you with this email address.',
    'If you’d rather delete your account, open the app and go to Settings → Delete account, or reply to support@caltracker.app.',
  ];
  const text = ['CalTracker', '', greeting, '', ...lines.flatMap((l) => [l, '']), '— CalTracker'].join('\n');
  const html = `<p><strong>CalTracker</strong></p>
<p>${escapeHtml(greeting)}</p>
${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n')}
<p>— CalTracker</p>`;
  return { subject, html, text };
}
