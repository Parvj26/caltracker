begin;
select plan(21);

-- Privileges: both functions are for the accept-invite Edge Function (service role) only.
select ok(not has_function_privilege('anon', 'public.invite_for_join(text)', 'execute'),
  'anon cannot call invite_for_join');
select ok(not has_function_privilege('authenticated', 'public.invite_for_join(text)', 'execute'),
  'authenticated cannot call invite_for_join');
select ok(has_function_privilege('service_role', 'public.invite_for_join(text)', 'execute'),
  'service_role can call invite_for_join');
select ok(not has_function_privilege('anon', 'public.accept_invite_for(uuid, uuid)', 'execute'),
  'anon cannot call accept_invite_for');
select ok(not has_function_privilege('authenticated', 'public.accept_invite_for(uuid, uuid)', 'execute'),
  'authenticated cannot call accept_invite_for');
select ok(has_function_privilege('service_role', 'public.accept_invite_for(uuid, uuid)', 'execute'),
  'service_role can call accept_invite_for');

select tests.create_user('ai-coach@t.local', 'Ai Coach') as coach \gset
select tests.create_workspace('AI Coaching', :'coach') as ws \gset
select tests.create_user('ai-coach2@t.local', 'Other Coach') as coach2 \gset
select tests.create_workspace('Other Coaching', :'coach2') as ws2 \gset

-- invite_for_join describes the invite and any existing account with that email.
select tests.create_invite(:'ws', 'new@t.local', 'New Person', :'coach', 'tok-new-0000000000000000') as inv_new \gset
select results_eq(
  $$select status, email::text, first_name, last_name, workspace_name, user_id from public.invite_for_join('tok-new-0000000000000000')$$,
  $$values ('valid'::text, 'new@t.local'::text, 'New'::text, 'Person'::text, 'AI Coaching'::text, null::uuid)$$,
  'a new email: valid invite, coach''s names, no account yet');
select results_eq(
  $$select status, invite_id from public.invite_for_join('tok-unknown-000000000000')$$,
  $$values ('not_found'::text, null::uuid)$$,
  'an unknown token is not_found');

select tests.create_invite(:'ws', 'old@t.local', 'Old Person', :'coach', 'tok-old-0000000000000000',
  now() - interval '1 day', now() - interval '15 days') as inv_old \gset
select is((select status from public.invite_for_join('tok-old-0000000000000000')), 'expired', 'an old invite is expired');

select tests.create_user('pending@t.local', 'Never Confirmed', false) as pending \gset
select tests.create_invite(:'ws', 'pending@t.local', 'Pending Person', :'coach', 'tok-pend-000000000000000') as inv_pend \gset
select results_eq(
  $$select user_id is not null, user_confirmed, user_is_coach from public.invite_for_join('tok-pend-000000000000000')$$,
  $$values (true, false, false)$$,
  'an unconfirmed account with that email is reported as unconfirmed');

select tests.create_invite(:'ws', 'ai-coach2@t.local', 'Coach Two', :'coach', 'tok-coach-00000000000000') as inv_coach \gset
select is((select user_is_coach from public.invite_for_join('tok-coach-00000000000000')), true,
  'an email that belongs to a coach is reported');

-- accept_invite_for links the user and marks the invite used.
select tests.create_user('new@t.local', 'New Person') as new_user \gset
select is(public.accept_invite_for(:'inv_new', :'new_user'), 'ok', 'accepting a valid invite succeeds');
select results_eq(
  format($$select workspace_id, role::text from public.workspace_members where user_id = %L$$, :'new_user'),
  format($$values (%L::uuid, 'client'::text)$$, :'ws'),
  'the user is now exactly one client membership of that workspace');
select results_eq(
  format($$select accepted_by from public.client_invites where id = %L$$, :'inv_new'),
  format($$values (%L::uuid)$$, :'new_user'),
  'the invite is marked accepted by that user');
select is(public.accept_invite_for(:'inv_new', :'new_user'), 'used', 'a second accept of the same invite is refused');
select is((select status from public.invite_for_join('tok-new-0000000000000000')), 'used', 'the link now reads as used');

select tests.create_user('old@t.local', 'Old Person') as old_user \gset
select is(public.accept_invite_for(:'inv_old', :'old_user'), 'expired', 'an expired invite cannot be accepted');

select is(public.accept_invite_for(:'inv_pend', :'pending'), 'email_unconfirmed',
  'the account must be confirmed before it is linked');

select tests.create_invite(:'ws', 'mismatch@t.local', 'Mis Match', :'coach', 'tok-mis-0000000000000000') as inv_mis \gset
select is(public.accept_invite_for(:'inv_mis', :'old_user'), 'email_mismatch',
  'an invite only links the account with the invited email');

select is(public.accept_invite_for(:'inv_coach', :'coach2'), 'coach_account', 'a coach is never linked as a client');

select tests.create_user('taken@t.local', 'Taken Client') as taken \gset
select tests.add_client(:'ws2', :'taken');
select tests.create_invite(:'ws', 'taken@t.local', 'Taken Client', :'coach', 'tok-taken-00000000000000') as inv_taken \gset
select is(public.accept_invite_for(:'inv_taken', :'taken'), 'other_coach',
  'a client of another coach is not moved');

select * from finish();
rollback;
