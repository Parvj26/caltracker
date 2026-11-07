export interface InviteEmailParams {
  /** The greeting uses the first name only: "Hi Sam,". */
  clientFirstName: string;
  coachName: string;
  workspaceName: string;
  acceptUrl: string;
  expiresAt: Date;
}

const escapeHtml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

// Brand colours (packages/design-tokens). Inlined because email clients ignore stylesheets.
const INK = '#121212';
const LIME = '#C8F169';
const WHITE = '#FFFFFF';

export const NEW_TO_APP_LINE = "New to CalTracker? You'll be able to get the app from the invite page.";

/**
 * A "bulletproof" button: a one-cell table with the colour on both the cell and the link, so it still looks like a
 * button in Outlook and Gmail. Clients that strip styles show the plain link printed underneath instead.
 */
function buttonHtml(href: string, label: string): string {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:16px 0 8px;">
  <tr>
    <td align="center" bgcolor="${INK}" style="background-color:${INK};border-radius:12px;border-bottom:4px solid ${LIME};">
      <a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:20px;color:${WHITE};text-decoration:none;border-radius:12px;">${label}</a>
    </td>
  </tr>
</table>`;
}

export function renderInviteEmail(p: InviteEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `${p.coachName} invited you to CalTracker`;
  const expires = p.expiresAt.toISOString().slice(0, 10);
  const text = [
    `Hi ${p.clientFirstName},`,
    '',
    `${p.coachName} has invited you to train with ${p.workspaceName} on CalTracker.`,
    '',
    `Join ${p.workspaceName}: ${p.acceptUrl}`,
    '',
    NEW_TO_APP_LINE,
    '',
    "Tap the link on your phone and choose a password. That's it.",
    '',
    `This link expires on ${expires}.`,
  ].join('\n');
  const url = escapeHtml(p.acceptUrl);
  const html = `<p>Hi ${escapeHtml(p.clientFirstName)},</p>
<p>${escapeHtml(p.coachName)} has invited you to train with ${escapeHtml(p.workspaceName)} on CalTracker.</p>
${buttonHtml(url, `Join ${escapeHtml(p.workspaceName)}`)}
<p style="font-size:13px;">Button not working? Copy this link into your browser:<br><a href="${url}">${url}</a></p>
<p>${escapeHtml(NEW_TO_APP_LINE)}</p>
<p>Tap the link on your phone and choose a password. That's it.</p>
<p>This link expires on ${expires}.</p>`;
  return { subject, html, text };
}
