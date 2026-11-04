begin;
select plan(51);

-- Fixtures (as postgres)
select tests.create_user('coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('a1@t.local', 'Client A1') as a1 \gset
select tests.create_workspace('Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');

select tests.create_invite(:'ws_a', 'x1@t.local', 'X One', :'coach_a', 'tok-a-x1') as inv_a1 \gset
select tests.create_invite(:'ws_a', 'x2@t.local', 'X Two', :'coach_a', 'tok-a-x2') as inv_a2 \gset
select tests.create_invite(:'ws_b', 'y1@t.local', 'Y One', :'coach_b', 'tok-b-y1') as inv_b1 \gset

-- Privileges
select ok(not has_table_privilege('anon', 'public.client_invites', 'select,insert,update,delete'),
  'anon has no privileges on client_invites');
select ok(not has_column_privilege('authenticated', 'public.client_invites', 'accepted_at', 'update')
  and not has_column_privilege('authenticated', 'public.client_invites', 'accepted_by', 'update'),
  'authenticated cannot update accepted_at/accepted_by directly');
select ok(not has_function_privilege('anon', 'public.claim_invites()', 'execute'),
  'anon cannot execute claim_invites');
select ok(has_function_privilege('authenticated', 'public.claim_invites()', 'execute'),
  'authenticated can execute claim_invites');
select ok(has_function_privilege('anon', 'public.get_invite_preview(text)', 'execute'),
  'anon can execute get_invite_preview');

-- RLS: coach A
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.client_invites), 2, 'coach A sees only A''s invites');
select is((select count(*)::int from public.client_invites where workspace_id = :'ws_b'), 0,
  'coach A cannot see B''s invites');
select throws_ok(format($q$insert into public.client_invites
  (workspace_id, email, first_name, token_hash, created_by)
  values (%L, 'new@t.local', 'New', 'h-new-a', %L)$q$, :'ws_a', :'coach_a'),
  '42501', null, 'coach A cannot insert an invite directly (writes go through send-invite)');
select throws_ok(format($q$insert into public.client_invites
  (workspace_id, email, first_name, token_hash, created_by)
  values (%L, 'evil@t.local', 'Evil', 'h-evil-b', %L)$q$, :'ws_b', :'coach_a'),
  '42501', null, 'coach A cannot insert an invite into B');
select throws_ok(format($q$insert into public.client_invites
  (workspace_id, email, first_name, token_hash, created_by)
  values (%L, 'spoof@t.local', 'Spoof', 'h-spoof', %L)$q$, :'ws_a', :'coach_b'),
  '42501', null, 'coach A cannot insert an invite attributed to someone else');
select throws_ok(format($q$insert into public.client_invites
  (workspace_id, email, first_name, token_hash, sent_at, created_by)
  values (%L, 'ts@t.local', 'Ts', 'h-ts', '2099-01-01', %L)$q$, :'ws_a', :'coach_a'),
  '42501', null, 'coach cannot set sent_at on insert');
select throws_ok(format($q$insert into public.client_invites
  (workspace_id, email, first_name, token_hash, expires_at, created_by)
  values (%L, 'ex@t.local', 'Ex', 'h-ex', now() + interval '1 year', %L)$q$, :'ws_a', :'coach_a'),
  '42501', null, 'coach cannot set expires_at on insert');
select throws_ok(format($q$update public.client_invites set sent_at = '2099-01-01' where id = %L$q$, :'inv_a1'),
  '42501', null, 'coach cannot update sent_at');
select throws_ok(format($q$update public.client_invites set expires_at = now() + interval '1 year' where id = %L$q$, :'inv_a1'),
  '42501', null, 'coach cannot update expires_at');
select ok((select expires_at = sent_at + interval '14 days' from public.client_invites
  where id = :'inv_a1'), 'invite gets the 14-day expiry window');
select throws_ok(format($q$update public.client_invites set first_name = 'X One Renamed' where id = %L$q$, :'inv_a1'),
  '42501', null, 'coach A cannot update A''s invite directly');
select throws_ok(format($q$update public.client_invites set first_name = 'Hacked' where id = %L$q$, :'inv_b1'),
  '42501', null, 'coach A cannot update B''s invite');
with d as (delete from public.client_invites where id = :'inv_a2' returning 1)
select is((select count(*)::int from d), 1, 'coach A deletes A''s invite');
with d as (delete from public.client_invites where id = :'inv_b1' returning 1)
select is((select count(*)::int from d), 0, 'coach A cannot delete B''s invite');

-- RLS: client of A and anon
select tests.act_as(:'a1');
select is((select count(*)::int from public.client_invites), 0, 'client sees 0 invites');
select throws_ok(format($q$insert into public.client_invites
  (workspace_id, email, first_name, token_hash, created_by)
  values (%L, 'c@t.local', 'C', 'h-c', %L)$q$, :'ws_a', :'a1'),
  '42501', null, 'client cannot insert invites into own workspace');
select tests.act_as_anon();
select throws_ok('select count(*) from public.client_invites', '42501', null,
  'anon cannot select client_invites directly');
reset role;

-- B's invite untouched by coach A
select results_eq(
  format($q$select full_name from public.client_invites where id = %L$q$, :'inv_b1'),
  $q$values ('Y One')$q$, 'B''s invite unchanged after coach A attempts');

-- claim: unconfirmed email
select tests.create_user('unc@t.local', 'Unconfirmed', false) as unc \gset
select tests.create_invite(:'ws_a', 'unc@t.local', 'Unconfirmed', :'coach_a', 'tok-unc');
select tests.act_as(:'unc');
select is((select count(*)::int from public.claim_invites()), 0, 'unconfirmed user claims nothing');
reset role;
select is((select count(*)::int from public.workspace_members where user_id = :'unc'), 0,
  'unconfirmed user has no membership');

-- claim: valid, with email normalised by trigger
select tests.create_user('sam@gmail.com', 'Sam') as sam \gset
select tests.create_invite(:'ws_a', 'Sam@Gmail.com ', 'Sam', :'coach_a', 'tok-sam') as inv_sam \gset
select is((select email::text from public.client_invites where id = :'inv_sam'), 'sam@gmail.com',
  'invite email is trimmed and lowercased on insert');
select tests.act_as(:'sam');
select is((select workspace_id from public.claim_invites()), :'ws_a'::uuid, 'confirmed user claims invite and gets workspace');
reset role;
select is((select count(*)::int from public.workspace_members
  where user_id = :'sam' and workspace_id = :'ws_a' and role = 'client'), 1, 'client membership created');
select ok((select accepted_at is not null and accepted_by = :'sam'::uuid
  from public.client_invites where id = :'inv_sam'), 'invite marked accepted by the user');

-- claim: expired
select tests.create_user('late@t.local', 'Late') as late \gset
select tests.create_invite(:'ws_a', 'late@t.local', 'Late', :'coach_a', 'tok-late',
  now() - interval '1 second') as inv_late \gset
select tests.act_as(:'late');
select is((select count(*)::int from public.claim_invites()), 0, 'expired invite is not claimed');
reset role;
select is((select count(*)::int from public.workspace_members where user_id = :'late'), 0,
  'no membership from expired invite');

-- claim: already a client of A, open invite from B
select tests.create_invite(:'ws_b', 'a1@t.local', 'Client A1', :'coach_b', 'tok-b-a1') as inv_b_a1 \gset
select tests.create_invite(:'ws_a', 'a1@t.local', 'Client A1', :'coach_a', 'tok-a-a1') as inv_a_a1 \gset
select tests.act_as(:'a1');
select is((select workspace_id from public.claim_invites()), :'ws_a'::uuid, 'existing client gets own workspace back');
reset role;
select is((select count(*)::int from public.workspace_members where user_id = :'a1' and role = 'client'), 1,
  'still exactly one client membership');
select ok((select accepted_at is null from public.client_invites where id = :'inv_b_a1'),
  'other workspace''s invite stays open');
select ok((select accepted_at is not null from public.client_invites where id = :'inv_a_a1'),
  'own workspace''s open invite is marked accepted');

-- claim: two open invites, later one wins
select tests.create_user('dual@t.local', 'Dual') as dual \gset
select tests.create_invite(:'ws_a', 'dual@t.local', 'Dual', :'coach_a', 'tok-dual-a') as inv_dual_a \gset
select tests.create_invite(:'ws_b', 'dual@t.local', 'Dual', :'coach_b', 'tok-dual-b',
  now() + interval '14 days', now() + interval '1 minute') as inv_dual_b \gset
select tests.act_as(:'dual');
select is((select workspace_id from public.claim_invites()), :'ws_b'::uuid, 'most recently sent invite wins');
reset role;
select is((select count(*)::int from public.workspace_members where user_id = :'dual'), 1, 'joined exactly one workspace');
select ok((select accepted_at is null from public.client_invites where id = :'inv_dual_a'),
  'the older invite stays open');

-- claim: coach invited as client
select tests.create_invite(:'ws_a', 'coach-b@t.local', 'Coach B', :'coach_a', 'tok-coach') as inv_coach \gset
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.claim_invites()), 0, 'coach claims nothing');
reset role;
select is((select count(*)::int from public.workspace_members where user_id = :'coach_b' and role = 'client'), 0,
  'coach gets no client membership');
select ok((select accepted_at is null from public.client_invites where id = :'inv_coach'),
  'invite for a coach stays open');

-- claim: idempotent
select tests.create_user('twice@t.local', 'Twice') as twice \gset
select tests.create_invite(:'ws_a', 'twice@t.local', 'Twice', :'coach_a', 'tok-twice');
select tests.act_as(:'twice');
select is((select workspace_id from public.claim_invites()), :'ws_a'::uuid, 'first claim joins A');
select is((select workspace_id from public.claim_invites()), :'ws_a'::uuid, 'second claim returns the same workspace');
reset role;
select is((select count(*)::int from public.workspace_members where user_id = :'twice'), 1,
  'still one membership after two claims');

-- preview
select tests.create_invite(:'ws_a', 'p-exp@t.local', 'Pexp', :'coach_a', 'tok-p-exp', now() - interval '1 day');
select tests.create_invite(:'ws_a', 'p-ok@t.local', 'Pok', :'coach_a', 'tok-p-ok');
select tests.act_as_anon();
select is((select status from public.get_invite_preview('tok-p-ok')), 'valid', 'anon previews a valid invite');
select is((select workspace_name from public.get_invite_preview('tok-p-ok')), 'Workspace A',
  'preview returns the workspace name');
select is((select status from public.get_invite_preview('tok-p-exp')), 'expired', 'expired invite previews as expired');
select is((select status from public.get_invite_preview('tok-sam')), 'accepted', 'claimed invite previews as accepted');
select is((select status from public.get_invite_preview('not-a-real-token')), 'not_found', 'unknown token is not_found');
select ok((select workspace_name is null and email is null and full_name is null
  from public.get_invite_preview('not-a-real-token')), 'not_found returns null details');
reset role;

-- Expiry window check (as postgres)
select throws_ok(format($q$insert into public.client_invites
  (workspace_id, email, first_name, token_hash, sent_at, expires_at, created_by)
  values (%L, 'long@t.local', 'Long', 'h-long', now(), now() + interval '15 days', %L)$q$, :'ws_a', :'coach_a'),
  '23514', null, 'expiry beyond 14 days after sent_at violates the check');

select * from finish();
rollback;
