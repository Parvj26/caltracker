-- Local development seed only. Demo accounts: password demo-password-123.
do $$
declare
  coach uuid := '00000000-0000-4000-8000-0000000000c1';
  cl uuid := '00000000-0000-4000-8000-0000000000c2';
  ws uuid := '00000000-0000-4000-8000-0000000000a1';
  u record;
begin
  for u in
    select * from (values
      (coach, 'coach@demo.local', 'Demo', 'Coach'),
      (cl, 'client@demo.local', 'Demo', 'Client')
    ) as t(id, email, first_name, last_name)
  loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
      u.email, extensions.crypt('demo-password-123', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('first_name', u.first_name, 'last_name', u.last_name, 'email_verified', true),
      now(), now(), '', '', '', ''
    );
    insert into auth.identities (
      id, provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), u.id::text, u.id,
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end loop;

  insert into public.workspaces (id, name) values (ws, 'Demo Coaching');
  insert into public.workspace_members (workspace_id, user_id, role) values
    (ws, coach, 'owner'),
    (ws, cl, 'client');
end;
$$;

-- Local only: where the award catch-up job (pg_cron) calls award-workout, and the shared secret it sends.
-- Not a real secret: put the same value in supabase/functions/.env as AWARD_WORKOUT_SECRET.
-- Staging and production create their own in Vault: see docs/runbooks/staging.md.
select vault.create_secret('http://host.docker.internal:54321/functions/v1/award-workout', 'award_workout_url',
  'award-workout Edge Function URL for the catch-up job');
select vault.create_secret('local-award-workout-secret', 'award_workout_secret',
  'Shared secret the catch-up job sends to award-workout');
