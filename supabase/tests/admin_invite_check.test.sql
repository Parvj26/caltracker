-- admin_can_invite: send-invite asks it when the caller isn't a coach of the workspace
-- (docs/superpowers/specs/2026-11-09-admin-dashboard-design.md, "Resend invite").
begin;
select plan(11);

select tests.create_user('ai-owner@t.local', 'Olive Owner') as owner \gset
select tests.create_user('ai-support@t.local', 'Sue Port') as support \gset
select tests.create_user('ai-ro@t.local', 'Rita Reader') as ro \gset
select tests.create_user('ai-nobody@t.local', 'No Body') as nobody \gset
insert into public.admin_users (user_id, role)
values (:'owner', 'owner'), (:'support', 'support'), (:'ro', 'readonly');
select tests.create_user('ai-ann@t.local', 'Ann Coach') as ann \gset
select tests.create_workspace('AI Alpha', :'ann') as ws \gset

select ok(not has_function_privilege('anon', 'public.admin_can_invite(uuid, text[])', 'execute'), 'anon cannot call admin_can_invite');

-- Denials.
select tests.act_as_aal(:'nobody', 'aal2');
select throws_ok(format('select public.admin_can_invite(%L, %L)', :'ws', '{x@t.local}'), '42501', 'admin: not authorised',
  'a non-admin is denied');
reset role;
select tests.act_as_aal(:'ann', 'aal2');
select throws_ok(format('select public.admin_can_invite(%L, %L)', :'ws', '{x@t.local}'), '42501', 'admin: not authorised',
  'a coach is not an admin (send-invite checks coaches first)');
reset role;
select tests.act_as_aal(:'ro', 'aal2');
select throws_ok(format('select public.admin_can_invite(%L, %L)', :'ws', '{x@t.local}'), '42501', 'admin: not authorised',
  'readonly is denied');
reset role;
select tests.act_as_aal(:'support', 'aal1');
select throws_ok(format('select public.admin_can_invite(%L, %L)', :'ws', '{x@t.local}'), '42501', 'admin: not authorised',
  'an aal1 support admin is denied');
reset role;
select is((select count(*)::int from public.admin_audit_log), 0, 'denials write no audit rows');

-- Support at aal2 may invite, and it is audited as resend_invite.
select tests.act_as_aal(:'support', 'aal2');
select is(public.admin_can_invite(:'ws', '{sam@t.local}'), true, 'support at aal2 can invite into any workspace');
select is(public.admin_can_invite(gen_random_uuid(), '{sam@t.local}'), false, 'an unknown workspace is refused');
reset role;
select tests.act_as_aal(:'owner', 'aal2');
select is(public.admin_can_invite(:'ws', '{kim@t.local}'), true, 'the owner can invite too');
reset role;
select results_eq('select admin_id, action, target_user_id, details from public.admin_audit_log order by id',
  format($$values (%L::uuid, 'resend_invite'::text, null::uuid, '{"workspace_id": "%s", "emails": ["sam@t.local"]}'::jsonb),
    (%L::uuid, 'resend_invite'::text, null::uuid, '{"workspace_id": "%s", "emails": ["kim@t.local"]}'::jsonb)$$,
    :'support', :'ws', :'owner', :'ws'),
  'one resend_invite audit row per allowed call, none for the unknown workspace');

select tests.create_user('ai-sam@t.local', 'Sam Lee') as sam \gset
select tests.act_as_aal(:'support', 'aal2');
select public.admin_can_invite(:'ws', '{AI-Sam@t.local}') as ignored \gset
reset role;
select is((select target_user_id from public.admin_audit_log order by id desc limit 1), :'sam'::uuid,
  'a single email with an account is logged against that person');

select * from finish();
rollback;
