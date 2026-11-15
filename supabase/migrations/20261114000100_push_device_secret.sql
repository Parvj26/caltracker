-- Push tokens can no longer be taken over by someone who merely knows them.
--
-- Before: register_push_device moved an existing token to whoever called it, so anyone who learned another
-- iPhone's APNs token could redirect that phone's notifications to their own account (and stop its owner getting them).
--
-- Now each app install makes a random secret once (kept in the iOS Keychain) and sends it with every register.
-- The server keeps only its SHA-256 (the secret is 256 random bits, so an unsalted hash is enough; the built-in
-- sha256() avoids a pgcrypto dependency). A row that has a secret hash moves to another user only when the caller
-- sends the matching secret: the same phone after sign-out/sign-in as someone else.
--
-- Backward compatibility (test phones run old builds, no OTA updates):
--   * Old builds send no secret. p_secret defaults to null, so their call (p_token, p_app_version) still resolves.
--   * Rows with a null secret hash (every row today, and every row an old build writes) keep the old behaviour:
--     any signed-in caller can move them. That is no worse than before, and a phone that upgrades sets its hash
--     on its next register, closing the hole for that phone.
--   * An old build can never take a row that has a secret: it sends none. That only happens on the same phone
--     after an upgrade, and iOS cannot downgrade an installed app, so no real phone is locked out.

alter table public.push_devices add column secret_hash text check (secret_hash ~ '^[0-9a-f]{64}$');

-- The owner may read their device rows, but never the hash.
revoke select on public.push_devices from authenticated;
grant select (token, user_id, platform, app_version, created_at, updated_at) on public.push_devices to authenticated;

drop function public.register_push_device(text, text);

create function public.register_push_device(p_token text, p_app_version text, p_secret text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_row public.push_devices%rowtype;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_secret is not null then
    if p_secret !~ '^[A-Za-z0-9_-]{32,128}$' then
      raise exception 'bad device secret' using errcode = '22023';
    end if;
    v_hash := encode(pg_catalog.sha256(convert_to(p_secret, 'UTF8')), 'hex');
  end if;

  -- Lock the token's row (if any) so two registers of the same token cannot race past the check.
  select * into v_row from public.push_devices d where d.token = p_token for update;

  if not found then
    insert into public.push_devices (token, user_id, app_version, secret_hash)
    values (p_token, v_uid, p_app_version, v_hash)
    on conflict (token) do nothing;
    if found then
      return;
    end if;
    -- Someone inserted it between our select and insert: check against their row.
    select * into v_row from public.push_devices d where d.token = p_token for update;
  end if;

  if v_row.user_id = v_uid then
    -- Already the caller's: refresh it, and record (or renew) the secret when one is sent.
    update public.push_devices
    set app_version = p_app_version, secret_hash = coalesce(v_hash, secret_hash), updated_at = now()
    where token = p_token;
  elsif v_row.secret_hash is null or v_row.secret_hash = v_hash then
    -- Legacy row (no secret yet), or the same install proving itself: the phone changed hands.
    update public.push_devices
    set user_id = v_uid, app_version = p_app_version, secret_hash = coalesce(v_hash, secret_hash), updated_at = now()
    where token = p_token;
  else
    raise exception 'this push token belongs to another device' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.register_push_device(text, text, text) from public, anon, authenticated;
grant execute on function public.register_push_device(text, text, text) to authenticated;
