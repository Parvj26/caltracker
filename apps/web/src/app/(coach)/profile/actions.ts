'use server';

import { revalidatePath } from 'next/cache';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, ProfileInput, codeForMessage, passwordBytes } from '@caltracker/shared';
import { acceptableAvatarFiles, type AvatarExt } from '@/lib/avatar-files';
import { fail, type ActionFailure } from '@/lib/action-result';
import { requireCoach } from '@/lib/auth';
import { createServerSupabase } from '@/lib/supabase/server';

/** `partial`: the name, bio and units were saved even though the business rename was refused. */
export type ProfileOutcome = { ok: true } | (ActionFailure & { partial?: true });


/** The name, business, bio and units. Only what changed is written; nothing changed means no write and no error. */
export async function saveProfile(input: ProfileInput): Promise<ProfileOutcome> {
  const coach = await requireCoach();
  const parsed = ProfileInput.safeParse(input);
  if (!parsed.success) return fail(codeForMessage(parsed.error.issues[0]?.message, 'field_format'), 'action:profile.saveProfile');
  const next = parsed.data;
  const supabase = await createServerSupabase();

  const profileChanged =
    next.firstName !== coach.firstName || next.lastName !== coach.lastName || next.bio !== coach.bio || next.units !== coach.units;
  if (profileChanged) {
    const { error } = await supabase
      .from('profiles')
      .update({ first_name: next.firstName, last_name: next.lastName, bio: next.bio, units: next.units })
      .eq('id', coach.userId);
    if (error) return fail('profile_save_failed', 'action:profile.saveProfile');
  }
  if (next.businessName !== coach.workspaceName) {
    // Owner-only in the database; a staff coach gets the refusal here.
    const { error } = await supabase.rpc('update_workspace_name', { p_name: next.businessName });
    if (error) {
      const why = error.code === '42501' ? 'business_name_owner_only' : 'business_name_save_failed';
      if (profileChanged) {
        revalidatePath('/', 'layout');
        return { ...fail(why, 'action:profile.saveProfile'), partial: true };
      }
      return fail(why, 'action:profile.saveProfile');
    }
  }
  if (profileChanged || next.businessName !== coach.workspaceName) revalidatePath('/', 'layout');
  return { ok: true };
}

const CONTENT_TYPE: Record<AvatarExt, string> = { webp: 'image/webp', jpg: 'image/jpeg' };

/**
 * Saves the photo the browser already cropped and compressed: form fields `avatar` (<= 1600 px) and `thumb` (256 px),
 * both WebP, or both JPEG (`ext`) when the browser can't make WebP.
 */
export async function uploadAvatar(formData: FormData): Promise<ProfileOutcome> {
  const coach = await requireCoach();
  const avatar = formData.get('avatar');
  const thumb = formData.get('thumb');
  const ext = formData.get('ext');
  const refused: ProfileOutcome = fail('avatar_unusable', 'action:profile.uploadAvatar');
  if (!(avatar instanceof Blob) || !(thumb instanceof Blob) || (ext !== 'webp' && ext !== 'jpg')) return fail('request_invalid', 'action:profile.uploadAvatar');
  if (!(await acceptableAvatarFiles(avatar, thumb, ext))) return refused;

  const supabase = await createServerSupabase();
  const folder = coach.userId;
  const options = { contentType: CONTENT_TYPE[ext], upsert: true, cacheControl: '3600' } as const;
  const [full, small] = await Promise.all([
    supabase.storage.from('avatars').upload(`${folder}/avatar.${ext}`, avatar, options),
    supabase.storage.from('avatars').upload(`${folder}/avatar-thumb.${ext}`, thumb, options),
  ]);
  if (full.error || small.error) return fail('upload_failed', 'action:profile.uploadAvatar');

  const { error } = await supabase.from('profiles').update({ avatar_path: `${folder}/avatar.${ext}` }).eq('id', coach.userId);
  if (error) return fail('avatar_save_failed', 'action:profile.uploadAvatar');
  // Best effort: drop the other format's files if the photo used to be saved the other way.
  const other: AvatarExt = ext === 'webp' ? 'jpg' : 'webp';
  await supabase.storage.from('avatars').remove([`${folder}/avatar.${other}`, `${folder}/avatar-thumb.${other}`]);
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Goes back to initials. The profile is updated first so a failed file delete can't leave a broken photo link. */
export async function removeAvatar(): Promise<ProfileOutcome> {
  const coach = await requireCoach();
  const supabase = await createServerSupabase();
  const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', coach.userId);
  if (error) return fail('avatar_remove_failed', 'action:profile.removeAvatar');
  // Best effort: the files are private and nothing points at them any more.
  await supabase.storage.from('avatars').remove(['webp', 'jpg'].flatMap((e) => [`${coach.userId}/avatar.${e}`, `${coach.userId}/avatar-thumb.${e}`]));
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function changePassword(input: { current: string; next: string; confirm: string }): Promise<ProfileOutcome> {
  const coach = await requireCoach();
  const { current, next, confirm } = input;
  if (typeof current !== 'string' || typeof next !== 'string' || typeof confirm !== 'string') return fail('request_invalid', 'action:profile.changePassword');
  if (current === '') return fail('password_current_required', 'action:profile.changePassword');
  if (next.length < PASSWORD_MIN_LENGTH) return fail('password_too_short', 'action:profile.changePassword');
  if (passwordBytes(next) > PASSWORD_MAX_LENGTH) return fail('password_too_long', 'action:profile.changePassword');
  if (next !== confirm) return fail('password_mismatch', 'action:profile.changePassword');
  if (next === current) return fail('password_reused', 'action:profile.changePassword');

  const supabase = await createServerSupabase();
  // Re-authenticate first: a stolen open session alone must not be enough to take over the account.
  const signedIn = await supabase.auth.signInWithPassword({ email: coach.email, password: current });
  if (signedIn.error) {
    return fail(signedIn.error.code === 'invalid_credentials' ? 'password_current_wrong' : 'server_error', 'action:profile.changePassword');
  }
  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) {
    return fail(error.code === 'same_password' ? 'password_reused' : 'password_change_failed', 'action:profile.changePassword');
  }
  return { ok: true };
}
