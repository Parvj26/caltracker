-- Admin roles, audit log and admin management (docs/superpowers/specs/2026-11-09-admin-dashboard-design.md).
begin;
select plan(49);

select tests.create_user('ac-owner@t.local', 'Olive Owner') as owner \gset
select tests.create_user('ac-support@t.local', 'Sue Port') as support \gset
select tests.create_user('ac-ro@t.local', 'Rita Reader') as ro \gset
select tests.create_user('ac-nobody@t.local', 'No Body') as nobody \gset
select tests.create_user('ac-new@t.local', 'Ned New') as newbie \gset
-- Bootstrap is a plain SQL insert (docs/runbooks/admin.md), never a migration.
insert into public.admin_users (user_id, role)
values (:'owner', 'owner'), (:'support', 'support'), (:'ro', 'readonly');

-- Structure.
select ok((select bool_and(c.relrowsecurity) from pg_class c
  where c.oid in ('public.admin_users'::regclass, 'public.admin_audit_log'::regclass)), 'admin tables have RLS');
select is((select count(*)::int from pg_policies where schemaname = 'public'
  and tablename in ('admin_users', 'admin_audit_log')), 0, 'admin tables have no policies');
select table_privs_are('public', 'admin_users', 'authenticated', array[]::text[], 'authenticated has no privileges on admin_users');
select table_privs_are('public', 'admin_audit_log', 'authenticated', array[]::text[], 'authenticated has no privileges on admin_audit_log');
select table_privs_are('public', 'admin_users', 'anon', array[]::text[], 'anon has no privileges on admin_users');
select table_privs_are('public', 'admin_audit_log', 'anon', array[]::text[], 'anon has no privileges on admin_audit_log');
select ok(not has_function_privilege('anon', 'public.admin_me()', 'execute')
  and not has_function_privilege('anon', 'public.admin_list_admins()', 'execute')
  and not has_function_privilege('anon', 'public.admin_set_admin(text, public.admin_role)', 'execute')
  and not has_function_privilege('anon', 'public.admin_remove_admin(uuid)', 'execute'), 'anon cannot call admin functions');
select ok(has_function_privilege('authenticated', 'public.admin_list_admins()', 'execute'),
  'signed-in users can call admin functions (they check the role themselves)');
select ok(not has_function_privilege('authenticated', 'private.admin_require(public.admin_role)', 'execute')
  and not has_function_privilege('authenticated', 'private.admin_audit(text, uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.admin_mask_email(text)', 'execute'),
  'the private helpers are not callable through the API');

-- Email masking.
select is(private.admin_mask_email('parv@gmail.com'), 'pa…@gmail.com', 'admin_mask_email(parv@gmail.com) = pa…@gmail.com');
select is(private.admin_mask_email('p@x.io'), 'p…@x.io', 'a one-letter name keeps its letter');
select is(private.admin_mask_email(null), null, 'no email stays null');

-- non-admin is denied.
select tests.act_as_aal(:'nobody', 'aal2');
select throws_ok('select * from public.admin_list_admins()', '42501', 'admin: not authorised', 'non-admin: list admins denied');
select throws_ok(format('select public.admin_set_admin(%L, %L)', 'ac-new@t.local', 'support'), '42501', 'admin: not authorised',
  'non-admin: set admin denied');
select throws_ok(format('select public.admin_remove_admin(%L)', :'ro'), '42501', 'admin: not authorised',
  'non-admin: remove admin denied');
select is((select count(*)::int from public.admin_me()), 0, 'non-admin: admin_me returns no rows');
-- authenticated cannot select or insert admin_users or admin_audit_log directly.
select throws_ok('select * from public.admin_users', '42501', null, 'cannot select admin_users directly');
select throws_ok(format('insert into public.admin_users (user_id, role) values (%L, %L)', :'nobody', 'owner'), '42501', null,
  'cannot insert into admin_users directly');
select throws_ok('select * from public.admin_audit_log', '42501', null, 'cannot select admin_audit_log directly');
select throws_ok(format('insert into public.admin_audit_log (admin_id, action) values (%L, %L)', :'nobody', 'x'), '42501', null,
  'cannot insert into admin_audit_log directly');
reset role;

-- aal1 admin is denied, but admin_me works at aal1.
select tests.act_as_aal(:'owner', 'aal1');
select throws_ok('select * from public.admin_list_admins()', '42501', 'admin: not authorised', 'aal1 owner: list admins denied');
select throws_ok(format('select public.admin_set_admin(%L, %L)', 'ac-new@t.local', 'support'), '42501', 'admin: not authorised',
  'aal1 owner: set admin denied');
select throws_ok(format('select public.admin_remove_admin(%L)', :'ro'), '42501', 'admin: not authorised',
  'aal1 owner: remove admin denied');
select results_eq('select role::text, email from public.admin_me()', $$values ('owner'::text, 'ac-owner@t.local'::text)$$,
  'aal1 owner: admin_me tells the sign-in page the role');
reset role;
select tests.act_as(:'owner');
select throws_ok('select * from public.admin_list_admins()', '42501', 'admin: not authorised', 'a JWT without aal is denied');
reset role;

-- readonly and support cannot manage admins.
select tests.act_as_aal(:'ro', 'aal2');
select throws_ok('select * from public.admin_list_admins()', '42501', 'admin: not authorised', 'readonly: list admins denied');
select throws_ok(format('select public.admin_set_admin(%L, %L)', 'ac-new@t.local', 'support'), '42501', 'admin: not authorised',
  'readonly: set admin denied');
select throws_ok(format('select public.admin_remove_admin(%L)', :'support'), '42501', 'admin: not authorised',
  'readonly: remove admin denied');
reset role;
select tests.act_as_aal(:'support', 'aal2');
select throws_ok('select * from public.admin_list_admins()', '42501', 'admin: not authorised', 'support: list admins denied');
select throws_ok(format('select public.admin_set_admin(%L, %L)', 'ac-new@t.local', 'owner'), '42501', 'admin: not authorised',
  'support: set admin denied');
select throws_ok(format('select public.admin_remove_admin(%L)', :'ro'), '42501', 'admin: not authorised',
  'support: remove admin denied');
reset role;
select is((select count(*)::int from public.admin_audit_log), 0, 'denied calls write no audit rows');

-- owner adds a support admin and one audit row is written.
select tests.act_as_aal(:'owner', 'aal2');
select is(public.admin_set_admin(' AC-New@T.local ', 'support'), :'newbie'::uuid, 'owner adds Ned by email (any case)');
reset role;
select results_eq(format('select role::text, created_by from public.admin_users where user_id = %L', :'newbie'),
  format($$values ('support'::text, %L::uuid)$$, :'owner'), 'Ned is support, added by the owner');
select results_eq('select admin_id, action, target_user_id, details from public.admin_audit_log',
  format($$values (%L::uuid, 'set_admin'::text, %L::uuid, '{"role": "support", "email": "ac-new@t.local", "previous_role": null}'::jsonb)$$,
    :'owner', :'newbie'),
  'exactly one audit row: set_admin, with the target and details');
select tests.act_as_aal(:'owner', 'aal2');
select results_eq('select email, first_name, last_name, role::text from public.admin_list_admins() order by email',
  $$values ('ac-new@t.local'::text, 'Ned'::text, 'New'::text, 'support'::text),
           ('ac-owner@t.local', 'Olive', 'Owner', 'owner'),
           ('ac-ro@t.local', 'Rita', 'Reader', 'readonly'),
           ('ac-support@t.local', 'Sue', 'Port', 'support')$$,
  'owner lists every admin with name, email and role');
select throws_ok(format('select public.admin_set_admin(%L, %L)', 'ghost@t.local', 'support'), 'P0002',
  'admin: no account with that email', 'an unknown email is refused');
select lives_ok(format('select public.admin_set_admin(%L, %L)', 'ac-new@t.local', 'readonly'), 'owner changes Ned to readonly');
reset role;
select is((select role::text from public.admin_users where user_id = :'newbie'), 'readonly', 'the role was updated');
select tests.act_as_aal(:'owner', 'aal2');
select lives_ok(format('select public.admin_remove_admin(%L)', :'newbie'), 'owner removes Ned');
select throws_ok(format('select public.admin_remove_admin(%L)', :'nobody'), 'P0002', 'admin: not an admin',
  'removing someone who is not an admin is refused');
reset role;
select is((select count(*)::int from public.admin_users where user_id = :'newbie'), 0, 'Ned is no longer an admin');
select results_eq('select action from public.admin_audit_log order by id',
  $$values ('set_admin'::text), ('set_admin'), ('remove_admin')$$, 'each change wrote one audit row; refusals wrote none');

-- cannot remove or demote the last owner.
select tests.act_as_aal(:'owner', 'aal2');
select throws_ok(format('select public.admin_remove_admin(%L)', :'owner'), 'P0001', 'admin: at least one owner is required',
  'the last owner cannot remove themself');
select throws_ok(format('select public.admin_set_admin(%L, %L)', 'ac-owner@t.local', 'support'), 'P0001',
  'admin: at least one owner is required', 'the last owner cannot demote themself');
select lives_ok(format('select public.admin_set_admin(%L, %L)', 'ac-support@t.local', 'owner'), 'owner promotes Sue to owner');
select lives_ok(format('select public.admin_set_admin(%L, %L)', 'ac-owner@t.local', 'support'),
  'with a second owner, the first can step down');
reset role;

-- audit log refuses update and delete.
select throws_ok('update public.admin_audit_log set action = ''x''', 'P0001', 'admin: audit log is append-only',
  'audit rows cannot be changed');
select throws_ok('delete from public.admin_audit_log', 'P0001', 'admin: audit log is append-only',
  'audit rows cannot be deleted');

select * from finish();
rollback;
