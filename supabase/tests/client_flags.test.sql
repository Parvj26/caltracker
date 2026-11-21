begin;
select plan(40);

-- Client flags (migration 20261121000500_client_flags.sql): coach-only pains, injuries and limitations, and the move
-- of the old free-text limitations note into one open General "Limitation" flag per client.

-- Fixtures (as postgres): workspace A with clients a1, a2 and a3, workspace B with client b1.
select tests.create_user('fl-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('fl-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('fl-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('fl-a3@t.local', 'Client A3') as a3 \gset
select tests.create_user('fl-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('fl-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('FL Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('FL Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_a', :'a3');
select tests.add_client(:'ws_b', :'b1');

-- ---------- Structure ----------
select ok((select relrowsecurity from pg_class where oid = 'public.client_flags'::regclass), 'RLS is enabled on client_flags');
select ok(not has_table_privilege('anon', 'public.client_flags', 'select'), 'anon has no access');
select ok(not has_column_privilege('authenticated', 'public.client_flags', 'workspace_id', 'update')
  and not has_column_privilege('authenticated', 'public.client_flags', 'client_id', 'update')
  and not has_column_privilege('authenticated', 'public.client_flags', 'created_by', 'insert')
  and not has_column_privilege('authenticated', 'public.client_flags', 'created_by', 'update')
  and not has_column_privilege('authenticated', 'public.client_flags', 'status', 'insert'),
  'owner columns cannot change, the author cannot be spoofed, and a flag starts open');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.proname = 'copy_limitations_to_flags' and p.prosecdef),
  'the note copy is not security definer');
select ok(not has_function_privilege('authenticated', 'private.copy_limitations_to_flags()', 'execute')
  and not has_function_privilege('anon', 'private.copy_limitations_to_flags()', 'execute'),
  'nobody signed in can run the note copy');
select ok(not has_table_privilege('authenticated', 'public.client_limitations', 'insert')
  and not has_table_privilege('authenticated', 'public.client_limitations', 'update')
  and has_table_privilege('authenticated', 'public.client_limitations', 'select'),
  'the old note is read-only now (still readable, never written)');

-- ---------- The coach writes flags for their own current clients ----------
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into public.client_flags (workspace_id, client_id, region, side, type, since, note)
  values (%L, %L, 'neck', 'centre', 'pain', '2026-11-20', 'Stiff after desk work')$$, :'ws_a', :'a1'),
  'coach flags their client''s neck');
select is((select created_by from public.client_flags where client_id = :'a1' and region = 'neck'), :'coach_a'::uuid,
  'the flag records its author');
select is((select status from public.client_flags where client_id = :'a1' and region = 'neck'), 'open', 'a new flag is open');
select lives_ok(format($$insert into public.client_flags (workspace_id, client_id, region, side, type, since, note)
  values (%L, %L, 'knee', 'L', 'limitation', '2026-09-02', 'No deep squats')$$, :'ws_a', :'a1'),
  'coach flags a left knee limitation');
select throws_ok(format($$insert into public.client_flags (workspace_id, client_id, region, side, type)
  values (%L, %L, 'spleen', 'L', 'pain')$$, :'ws_a', :'a1'), '23514', null, 'an unknown region is refused');
select throws_ok(format($$insert into public.client_flags (workspace_id, client_id, region, side, type)
  values (%L, %L, 'knee', 'up', 'pain')$$, :'ws_a', :'a1'), '23514', null, 'an unknown side is refused');
select throws_ok(format($$insert into public.client_flags (workspace_id, client_id, region, side, type)
  values (%L, %L, 'knee', 'L', 'ache')$$, :'ws_a', :'a1'), '23514', null, 'an unknown type is refused');
select throws_ok(format($$insert into public.client_flags (workspace_id, client_id, region, side, type)
  values (%L, %L, null, 'L', 'pain')$$, :'ws_a', :'a1'), '23514', null, 'a General flag sits in the centre');
select throws_ok(format($$insert into public.client_flags (workspace_id, client_id, region, side, type, note)
  values (%L, %L, 'knee', 'L', 'pain', repeat('x', 2001))$$, :'ws_a', :'a1'), '23514', null, 'a note over 2000 characters is refused');
select throws_ok(format($$insert into public.client_flags (workspace_id, client_id, region, side, type)
  values (%L, %L, 'knee', 'L', 'pain')$$, :'ws_b', :'b1'), '42501', null, 'coach cannot flag a client in another workspace');
select throws_ok(format($$insert into public.client_flags (workspace_id, client_id, region, side, type)
  values (%L, %L, 'knee', 'L', 'pain')$$, :'ws_a', :'b1'), '42501', null, 'coach cannot flag someone who is not their client');
select throws_ok(format($$update public.client_flags set status = 'resolved' where client_id = %L and region = 'neck'$$, :'a1'),
  '23514', null, 'resolving needs a resolved date');
update public.client_flags set status = 'resolved', resolved_on = '2026-11-21' where client_id = :'a1' and region = 'neck';
select is((select resolved_on from public.client_flags where client_id = :'a1' and region = 'neck'), '2026-11-21'::date,
  'coach resolves a flag');
update public.client_flags set status = 'open', resolved_on = null where client_id = :'a1' and region = 'neck';
select is((select status from public.client_flags where client_id = :'a1' and region = 'neck'), 'open', 'and reopens it');
reset role;

-- ---------- Nobody else reads or writes them ----------
select tests.act_as(:'a1');
select is((select count(*)::int from public.client_flags), 0, 'the client cannot read their own flags (coach-only)');
select throws_ok(format($$insert into public.client_flags (workspace_id, client_id, region, side, type)
  values (%L, %L, 'knee', 'L', 'pain')$$, :'ws_a', :'a1'), '42501', null, 'the client cannot add a flag');
update public.client_flags set note = 'hacked';
delete from public.client_flags;
reset role;
select tests.act_as(:'a2');
select is((select count(*)::int from public.client_flags), 0, 'another client of the workspace reads no flags');
reset role;
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.client_flags), 0, 'another workspace''s coach reads no flags');
update public.client_flags set note = 'hacked';
update public.client_flags set status = 'resolved', resolved_on = current_date;
delete from public.client_flags;
reset role;
select tests.act_as(:'b1');
select is((select count(*)::int from public.client_flags), 0, 'another workspace''s client reads no flags');
reset role;
select is((select count(*)::int from public.client_flags where client_id = :'a1' and note <> 'hacked' and status = 'open'), 2,
  'nobody but the coach of the workspace can edit, resolve or delete a flag');
select tests.act_as_anon();
select throws_ok('select * from public.client_flags', '42501', null, 'anon cannot read flags');
reset role;

-- ---------- A removed client's flags stay readable to the coach, but can't change ----------
delete from public.workspace_members where workspace_id = :'ws_a' and user_id = :'a1';
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.client_flags where client_id = :'a1'), 2, 'the coach still reads a removed client''s flags');
select throws_ok(format($$update public.client_flags set note = 'later' where client_id = %L and region = 'knee'$$, :'a1'),
  '42501', null, 'but cannot edit them');
select throws_ok(format($$insert into public.client_flags (workspace_id, client_id, region, side, type)
  values (%L, %L, 'knee', 'L', 'pain')$$, :'ws_a', :'a1'), '42501', null, 'or add one');
select tests.act_as(:'coach_a');
select lives_ok(format($$delete from public.client_flags where client_id = %L and region = 'knee'$$, :'a1'),
  'the coach may delete a removed client''s flag');
reset role;

-- ---------- The old free-text note moves over ----------
-- As the migration owner: a2 has a note, a3 a blank one, b1 a note in workspace B.
insert into public.client_limitations (workspace_id, client_id, body, updated_at) values
  (:'ws_a', :'a2', E'  Left knee: no deep squats.\nLower back: go light  ', '2026-10-05 22:30:00+00'),
  (:'ws_a', :'a3', E'  \n ', now()),
  (:'ws_b', :'b1', 'Right shoulder: no overhead pressing', '2026-11-01 08:00:00+00');
select is(private.copy_limitations_to_flags(), 2, 'each non-blank note becomes one flag');
select results_eq(
  format($$select region, side, type, status, since, note, created_by from public.client_flags where client_id = %L$$, :'a2'),
  $$values (null::text, 'centre'::text, 'limitation'::text, 'open'::text, '2026-10-05'::date,
    E'Left knee: no deep squats.\nLower back: go light'::text, null::uuid)$$,
  'it is one open General Limitation, the whole text kept (trimmed), since the day it was last saved');
select is((select count(*)::int from public.client_flags where client_id = :'a3'), 0, 'a blank note makes no flag');
select is((select workspace_id from public.client_flags where client_id = :'b1'), :'ws_b'::uuid, 'each flag stays in its own workspace');
select is(private.copy_limitations_to_flags(), 0, 'running it again copies nothing twice');
select is((select count(*)::int from public.client_limitations), 3, 'the old notes stay where they were');

-- The moved flag is the coach's like any other: readable in A, not in B.
select tests.act_as(:'coach_a');
select is((select note from public.client_flags where client_id = :'a2'), E'Left knee: no deep squats.\nLower back: go light',
  'the coach reads the moved note as a flag');
select throws_ok(format($$update public.client_limitations set body = 'new' where client_id = %L$$, :'a2'),
  '42501', null, 'and can no longer write the old note');
reset role;
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.client_flags where client_id = :'a2'), 0, 'another coach cannot read the moved note');
reset role;

select * from finish();
rollback;
