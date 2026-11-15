-- register_push_device's per-install secret (migration 20261114000100): a token that has a secret moves to another
-- user only with that secret; old builds (no secret) keep working.
begin;
select plan(24);

select tests.create_user('pds-coach@t.local', 'Coach') as coach \gset
select tests.create_workspace('PDS Coaching', :'coach') as ws \gset
select tests.create_user('pds-sam@t.local', 'Sam') as sam \gset
select tests.add_client(:'ws', :'sam');
select tests.create_user('pds-kim@t.local', 'Kim') as kim \gset
select tests.add_client(:'ws', :'kim');
select tests.create_user('pds-eve@t.local', 'Eve') as eve \gset
select tests.add_client(:'ws', :'eve');

\set tok_a '''' `printf 'a%.0s' $(seq 64)` ''''
\set phone_secret '''phone-secret-0123456789abcdefghijklmnop'''
\set wrong_secret '''attacker-secret-0123456789abcdefghijklm'''

-- Structure.
select ok(has_function_privilege('authenticated', 'public.register_push_device(text, text, text)', 'execute'),
  'authenticated can register');
select ok(not has_function_privilege('anon', 'public.register_push_device(text, text, text)', 'execute'), 'anon cannot');
select hasnt_function('public', 'register_push_device', array['text', 'text'], 'the two-argument version is gone (no ambiguity)');
select ok(not has_column_privilege('authenticated', 'public.push_devices', 'secret_hash', 'select'),
  'clients cannot read the secret hash');

-- Same device re-registers with its secret.
select tests.act_as(:'sam');
select lives_ok(format('select public.register_push_device(%L, %L, %L)', :tok_a, '2.0.0', :phone_secret),
  'sam registers with the phone secret');
select lives_ok(format('select public.register_push_device(%L, %L, %L)', :tok_a, '2.0.1', :phone_secret),
  'sam re-registers the same device');
select lives_ok(format('select public.register_push_device(%L, %L)', :tok_a, '2.0.1'),
  'sam re-registers without a secret (own row)');
reset role;
select is((select user_id from public.push_devices where token = :tok_a), :'sam'::uuid, 'still sam''s');
select is((select secret_hash from public.push_devices where token = :tok_a),
  encode(sha256(convert_to(:phone_secret, 'UTF8')), 'hex'), 'only the SHA-256 of the secret is stored, and kept');
select isnt((select secret_hash from public.push_devices where token = :tok_a), :phone_secret, 'not the plain secret');

-- An attacker who knows the token but not the secret.
select tests.act_as(:'eve');
select throws_ok(format('select public.register_push_device(%L, %L)', :tok_a, '1.0.0'), '42501', null,
  'eve without a secret cannot take it');
select throws_ok(format('select public.register_push_device(%L, %L, %L)', :tok_a, '1.0.0', :wrong_secret), '42501', null,
  'eve with the wrong secret cannot take it');
select throws_ok(format('select public.register_push_device(%L, %L, %L)', :tok_a, '1.0.0', 'short'), '22023', null,
  'a malformed secret is refused');
reset role;
select is((select user_id from public.push_devices where token = :tok_a), :'sam'::uuid, 'the token stays sam''s');

-- Same phone, different user: kim signs in after sam (sam's unregister did not get through).
select tests.act_as(:'kim');
select lives_ok(format('select public.register_push_device(%L, %L, %L)', :tok_a, '2.0.1', :phone_secret),
  'kim on the same phone (same secret) takes the token');
reset role;
select is((select user_id from public.push_devices where token = :tok_a), :'kim'::uuid, 'now kim''s');
select is((select count(*)::int from public.push_devices where token = :tok_a), 1, 'one row per token');

-- Sign out then sign in (the normal path): the row is removed, then re-inserted for the next user.
select tests.act_as(:'kim');
select public.unregister_push_device(:tok_a);
reset role;
select tests.act_as(:'sam');
select lives_ok(format('select public.register_push_device(%L, %L, %L)', :tok_a, '2.0.1', :phone_secret),
  'sam signs back in on that phone');
reset role;
select is((select user_id from public.push_devices where token = :tok_a), :'sam'::uuid, 'sam''s again');

-- Legacy rows (old builds, no secret) keep the old behaviour: any signed-in user can move them.
\set tok_b '''' `printf 'b%.0s' $(seq 64)` ''''
select tests.act_as(:'sam');
select public.register_push_device(:tok_b, '1.0.0');
reset role;
select is((select secret_hash from public.push_devices where token = :tok_b), null, 'an old build stores no secret');
select tests.act_as(:'kim');
select lives_ok(format('select public.register_push_device(%L, %L)', :tok_b, '1.0.0'),
  'old build: another user on the phone still moves the token');
reset role;
select is((select user_id from public.push_devices where token = :tok_b), :'kim'::uuid, 'legacy row moved');

-- The phone upgrades: its next register (with a secret) protects the row from then on.
select tests.act_as(:'kim');
select public.register_push_device(:tok_b, '2.0.0', :phone_secret);
reset role;
select ok((select secret_hash is not null from public.push_devices where token = :tok_b), 'upgrade records the secret');
select tests.act_as(:'eve');
select throws_ok(format('select public.register_push_device(%L, %L)', :tok_b, '1.0.0'), '42501', null,
  'after the upgrade a secretless call cannot take it');
reset role;

select * from finish();
rollback;
