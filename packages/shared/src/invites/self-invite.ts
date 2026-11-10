/**
 * A coach can't be their own client under the same email, but Gmail and most providers deliver
 * `name+anything@domain` to `name@domain`. This is the address we suggest for testing as a client.
 */
export function clientTestEmail(coachEmail: string): string {
  const email = coachEmail.trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at).split('+')[0];
  return `${local}+client${email.slice(at)}`;
}

/** Shown when a coach invites their own email. */
export function selfInviteMessage(coachEmail: string): string {
  return `That's your coach email. To test as a client, use ${clientTestEmail(coachEmail)}`;
}
