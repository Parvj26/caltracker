-- admin_can_invite: send-invite asks it when the caller isn't a coach of the workspace
-- (docs/superpowers/specs/2026-11-09-admin-dashboard-design.md, "Resend invite", "Move client", "Restore").
-- Admins may only (re)invite people already in the system: an email with an invite in any workspace, or a past client.
begin;
select plan(17);

select tests.create_user('ai-owner@t.local', 'Olive Owner') as owner \gset
select tests.create_user('ai-support@t.local', 'Sue Port') as support \gset
select tests.create_user('ai-ro@t.local', 'Rita Reader') as ro \gset
select tests.create_user('ai-nobody@t.local', 'No Body') as nobody \gset
insert into public.admin_users (user_id, role)
values (:'owner', 'owner'), (:'support', 'support'), (:'ro', 'readonly');
select tests.create_user('ai-ann@t.local', 'Ann Coach') as ann \gset
select tests.create_workspace('AI Alpha', :'ann') as ws \gset
select tests.create_user('ai-bob@t.local', 'Bob Coach') as bob \gset
select tests.create_workspace('AI Beta', :'bob') as ws_b \gset

-- Sam has an invite from Ann; Kim was Bob's client and was removed; Sue (support) also has an invite of her own.
select tests.create_user('ai-sam@t.local', 'Sam Lee') as sam \gset
select tests.create_invite(:'ws', 'ai-sam@t.local', 'Sam Lee', :'ann', 'tok-ai-sam-0000000000000') as inv_sam \gset
select tests.create_user('ai-kim@t.local', 'Kim Park') as kim \gset
insert into public.past_clients (workspace_id, user_id, email, first_name, last_name, removed_by)
values (:'ws_b', :'kim', 'ai-kim@t.local', 'Kim', 'Park', :'bob');
select tests.create_invite(:'ws', 'ai-support@t.local', 'Sue Port', :'ann', 'tok-ai-sue-0000000000000') as inv_sue \gset

select ok(not has_function_privilege('anon', 'public.admin_can_invite(uuid, text[])', 'execute'), 'anon cannot call admin_can_invite');

-- Denials.
select tests.act_as_aal(:'nobody', 'aal2');
select throws_ok(format('select public.admin_can_invite(%L, %L)', :'ws', '{ai-sam@t.local}'), '42501', 'admin: not authorised',
  'a non-admin is denied');
reset role;
select tests.act_as_aal(:'ann', 'aal2');
select throws_ok(format('select public.admin_can_invite(%L, %L)', :'ws', '{ai-sam@t.local}'), '42501', 'admin: not authorised',
  'a coach is not an admin (send-invite checks coaches first)');
reset role;
select tests.act_as_aal(:'ro', 'aal2');
select throws_ok(format('select public.admin_can_invite(%L, %L)', :'ws', '{ai-sam@t.local}'), '42501', 'admin: not authorised',
  'readonly is denied');
reset role;
select tests.act_as_aal(:'support', 'aal1');
select throws_ok(format('select public.admin_can_invite(%L, %L)', :'ws', '{ai-sam@t.local}'), '42501', 'admin: not authorised',
  'an aal1 support admin is denied');
reset role;
select is((select count(*)::int from public.admin_audit_log), 0, 'denials write no audit rows');

-- Which emails an admin may invite.
select tests.act_as_aal(:'support', 'aal2');
select is(public.admin_can_invite(:'ws', '{someone-new@t.local}'), false, 'admin cannot invite an arbitrary new email');
select is(public.admin_can_invite(:'ws', '{AI-Support@t.local}'), false, 'admin cannot invite own email (even with an invite)');
select is(public.admin_can_invite(:'ws', '{ai-sam@t.local, someone-new@t.local}'), false,
  'one email that fails refuses the whole request');
select is(public.admin_can_invite(:'ws', '{}'), false, 'no emails: refused');
select is(public.admin_can_invite(gen_random_uuid(), '{ai-sam@t.local}'), false, 'an unknown workspace is refused');
reset role;
select is((select count(*)::int from public.admin_audit_log), 0, 'refusals write no audit rows');

select tests.act_as_aal(:'support', 'aal2');
select is(public.admin_can_invite(:'ws', '{AI-Sam@t.local}'), true, 'admin can resend to an existing invite email');
select is(public.admin_can_invite(:'ws', '{ai-kim@t.local}'), true, 'admin can re-invite a past client (into any workspace)');
reset role;
select tests.act_as_aal(:'owner', 'aal2');
select is(public.admin_can_invite(:'ws_b', '{ai-sam@t.local, ai-kim@t.local}'), true,
  'the owner can invite several known people at once');
reset role;
select results_eq('select admin_id, action, target_user_id, details from public.admin_audit_log order by id',
  format($$values
    (%L::uuid, 'resend_invite'::text, %L::uuid, '{"workspace_id": "%s", "emails": ["ai-sam@t.local"]}'::jsonb),
    (%L::uuid, 'resend_invite'::text, %L::uuid, '{"workspace_id": "%s", "emails": ["ai-kim@t.local"]}'::jsonb),
    (%L::uuid, 'resend_invite'::text, null::uuid, '{"workspace_id": "%s", "emails": ["ai-kim@t.local", "ai-sam@t.local"]}'::jsonb)$$,
    :'support', :'sam', :'ws', :'support', :'kim', :'ws', :'owner', :'ws_b'),
  'one resend_invite audit row per allowed call, logged against the person when there is one');
select is((select count(*)::int from public.client_invites where id in (:'inv_sam', :'inv_sue')), 2,
  'admin_can_invite changes no invites itself');

select * from finish();
rollback;
