begin;
select plan(81);

-- Fixtures (as postgres): workspace A with clients a1 and a2, workspace B with client b1.
select tests.create_user('co-coach-a@t.local', 'Coach A') as coach_a \gset
select tests.create_user('co-a1@t.local', 'Client A1') as a1 \gset
select tests.create_user('co-a2@t.local', 'Client A2') as a2 \gset
select tests.create_user('co-coach-b@t.local', 'Coach B') as coach_b \gset
select tests.create_user('co-b1@t.local', 'Client B1') as b1 \gset
select tests.create_workspace('CO Workspace A', :'coach_a') as ws_a \gset
select tests.create_workspace('CO Workspace B', :'coach_b') as ws_b \gset
select tests.add_client(:'ws_a', :'a1');
select tests.add_client(:'ws_a', :'a2');
select tests.add_client(:'ws_b', :'b1');
select gen_random_uuid() as doc_a1, gen_random_uuid() as f_a1, gen_random_uuid() as f_b1 \gset

-- ---------- Structure ----------
select ok((select bool_and(c.relrowsecurity) from pg_class c
  where c.oid in ('public.client_notes'::regclass, 'public.client_limitations'::regclass,
    'public.client_goals'::regclass, 'public.client_documents'::regclass)), 'RLS is enabled on all four tables');
select ok(not has_table_privilege('anon', 'public.client_notes', 'select')
  and not has_table_privilege('anon', 'public.client_limitations', 'select')
  and not has_table_privilege('anon', 'public.client_goals', 'select')
  and not has_table_privilege('anon', 'public.client_documents', 'select'), 'anon has no access to any of them');
select ok(not has_column_privilege('authenticated', 'public.client_notes', 'client_id', 'update')
  and not has_column_privilege('authenticated', 'public.client_notes', 'workspace_id', 'update')
  and not has_column_privilege('authenticated', 'public.client_notes', 'created_by', 'insert')
  and not has_column_privilege('authenticated', 'public.client_goals', 'client_id', 'update')
  and not has_column_privilege('authenticated', 'public.client_limitations', 'workspace_id', 'update')
  and not has_column_privilege('authenticated', 'public.client_documents', 'storage_path', 'update')
  and not has_column_privilege('authenticated', 'public.client_documents', 'uploaded_by', 'insert'),
  'owner columns and paths cannot be changed after insert, and authors cannot be spoofed');
select is((select public from storage.buckets where id = 'client-documents'), false, 'client-documents bucket is private');
select is((select file_size_limit from storage.buckets where id = 'client-documents'), 5242880::bigint, 'files are at most 5 MB');
select is((select allowed_mime_types from storage.buckets where id = 'client-documents'),
  array['application/pdf', 'image/webp', 'image/jpeg'], 'only PDFs and images are accepted (no video)');

-- ---------- Notes (coach-private) ----------
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into public.client_notes (workspace_id, client_id, body) values (%L, %L, 'Prefers mornings')$$,
  :'ws_a', :'a1'), 'coach adds a note for their client');
select is((select created_by from public.client_notes where client_id = :'a1'), :'coach_a'::uuid, 'the note records its author');
select throws_ok(format($$insert into public.client_notes (workspace_id, client_id, body) values (%L, %L, 'x')$$, :'ws_b', :'b1'),
  '42501', null, 'coach cannot add a note in another workspace');
select throws_ok(format($$insert into public.client_notes (workspace_id, client_id, body) values (%L, %L, 'x')$$, :'ws_a', :'b1'),
  '42501', null, 'coach cannot add a note for someone who is not their client');
select throws_ok(format($$insert into public.client_notes (workspace_id, client_id, body) values (%L, %L, '   ')$$, :'ws_a', :'a1'),
  '23514', null, 'an empty note is refused');
select throws_ok(format($$insert into public.client_notes (workspace_id, client_id, body) values (%L, %L, repeat('x', 2001))$$, :'ws_a', :'a1'),
  '23514', null, 'a note over 2000 characters is refused');
update public.client_notes set body = 'Prefers early mornings' where client_id = :'a1';
select is((select body from public.client_notes where client_id = :'a1'), 'Prefers early mornings', 'coach edits a note');
select ok((select updated_at > created_at or updated_at = created_at from public.client_notes where client_id = :'a1'), 'updated_at is kept');
reset role;

select tests.act_as(:'a1');
select is((select count(*)::int from public.client_notes), 0, 'the client cannot read notes about themselves');
select throws_ok(format($$insert into public.client_notes (workspace_id, client_id, body) values (%L, %L, 'mine')$$, :'ws_a', :'a1'),
  '42501', null, 'the client cannot add a note');
update public.client_notes set body = 'hacked';
delete from public.client_notes;
reset role;
select tests.act_as(:'a2');
select is((select count(*)::int from public.client_notes), 0, 'another client of the workspace reads no notes');
reset role;
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.client_notes), 0, 'another workspace''s coach reads no notes');
update public.client_notes set body = 'hacked';
delete from public.client_notes;
reset role;
select tests.act_as(:'b1');
select is((select count(*)::int from public.client_notes), 0, 'another workspace''s client reads no notes');
reset role;
select is((select body from public.client_notes where client_id = :'a1'), 'Prefers early mornings',
  'nobody but the coach of the workspace can edit or delete a note');
select tests.act_as_anon();
select throws_ok('select * from public.client_notes', '42501', null, 'anon cannot read notes');
reset role;

-- ---------- Limitations / injuries (coach-private, one per client) ----------
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into public.client_limitations (workspace_id, client_id, body) values (%L, %L, 'Left knee: no deep squats')$$,
  :'ws_a', :'a1'), 'coach records limitations');
select throws_ok(format($$insert into public.client_limitations (workspace_id, client_id, body) values (%L, %L, 'again')$$, :'ws_a', :'a1'),
  '23505', null, 'there is one limitations record per client');
select lives_ok(format($$insert into public.client_limitations (workspace_id, client_id, body) values (%L, %L, '')$$, :'ws_a', :'a2'),
  'limitations may be cleared to empty');
select throws_ok(format($$insert into public.client_limitations (workspace_id, client_id, body) values (%L, %L, repeat('x', 2001))$$, :'ws_b', :'b1'),
  '42501', null, 'coach cannot write limitations in another workspace');
select throws_ok(format($$update public.client_limitations set body = repeat('x', 2001) where client_id = %L$$, :'a1'),
  '23514', null, 'limitations over 2000 characters are refused');
update public.client_limitations set body = 'Left knee: no deep squats. Shoulder ok.' where client_id = :'a1';
select is((select body from public.client_limitations where client_id = :'a1'), 'Left knee: no deep squats. Shoulder ok.', 'coach edits limitations');
reset role;
select tests.act_as(:'a1');
select is((select count(*)::int from public.client_limitations), 0, 'the client cannot read their limitations record');
select throws_ok(format($$insert into public.client_limitations (workspace_id, client_id, body) values (%L, %L, 'x')$$, :'ws_a', :'a1'),
  '42501', null, 'the client cannot write limitations');
reset role;
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.client_limitations), 0, 'another workspace''s coach reads no limitations');
update public.client_limitations set body = 'hacked';
delete from public.client_limitations;
reset role;
select tests.act_as(:'b1');
select is((select count(*)::int from public.client_limitations), 0, 'another workspace''s client reads no limitations');
reset role;
select is((select count(*)::int from public.client_limitations where workspace_id = :'ws_a' and body <> 'hacked'), 2,
  'another workspace''s coach cannot edit or delete limitations');
select tests.act_as_anon();
select throws_ok('select * from public.client_limitations', '42501', null, 'anon cannot read limitations');
reset role;

-- ---------- Goals (shared with the client) ----------
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into public.client_goals (workspace_id, client_id, goal, target_date) values (%L, %L, 'Run the half marathon', '2027-02-14')$$,
  :'ws_a', :'a1'), 'coach sets a goal with a countdown date');
select lives_ok(format($$insert into public.client_goals (workspace_id, client_id, goal) values (%L, %L, 'Squat body weight')$$,
  :'ws_a', :'a2'), 'the countdown date is optional');
select throws_ok(format($$insert into public.client_goals (workspace_id, client_id, goal) values (%L, %L, 'again')$$, :'ws_a', :'a1'),
  '23505', null, 'there is one goal per client');
select throws_ok(format($$update public.client_goals set goal = ' ' where client_id = %L$$, :'a1'), '23514', null, 'an empty goal is refused');
select throws_ok(format($$update public.client_goals set goal = repeat('x', 201) where client_id = %L$$, :'a1'),
  '23514', null, 'a goal over 200 characters is refused');
select throws_ok(format($$insert into public.client_goals (workspace_id, client_id, goal) values (%L, %L, 'x')$$, :'ws_b', :'b1'),
  '42501', null, 'coach cannot set a goal in another workspace');
reset role;
select tests.act_as(:'a1');
select is((select goal from public.client_goals), 'Run the half marathon', 'the client reads their own goal and only theirs');
update public.client_goals set goal = 'Changed by client';
delete from public.client_goals;
select throws_ok(format($$insert into public.client_goals (workspace_id, client_id, goal) values (%L, %L, 'mine')$$, :'ws_a', :'a1'),
  '42501', null, 'the client cannot set a goal');
reset role;
select is((select goal from public.client_goals where client_id = :'a1'), 'Run the half marathon', 'the client cannot change or delete their goal');
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.client_goals), 0, 'another workspace''s coach reads no goals');
update public.client_goals set goal = 'hacked';
reset role;
select tests.act_as(:'b1');
select is((select count(*)::int from public.client_goals), 0, 'another workspace''s client reads no goals');
reset role;
select is((select count(*)::int from public.client_goals where goal = 'hacked'), 0, 'another workspace''s coach cannot edit goals');
select tests.act_as_anon();
select throws_ok('select * from public.client_goals', '42501', null, 'anon cannot read goals');
reset role;

-- ---------- Documents (coach uploads; the client reads only what is shared) ----------
select tests.act_as(:'coach_a');
select lives_ok(format($$insert into public.client_documents (id, workspace_id, client_id, name, storage_path, content_type, size_bytes)
  values (%L, %L, %L, 'Medical clearance', %L, 'application/pdf', 120000)$$,
  :'doc_a1', :'ws_a', :'a1', :'ws_a' || '/' || :'a1' || '/' || :'f_a1' || '.pdf'), 'coach adds a document');
select is((select shared_with_client from public.client_documents where id = :'doc_a1'), false, 'documents start private to the coach');
select is((select uploaded_by from public.client_documents where id = :'doc_a1'), :'coach_a'::uuid, 'the document records who uploaded it');
select throws_ok(format($$insert into public.client_documents (workspace_id, client_id, name, storage_path, content_type, size_bytes)
  values (%L, %L, 'Wrong place', %L, 'application/pdf', 1000)$$,
  :'ws_a', :'a1', :'ws_a' || '/' || :'a2' || '/' || gen_random_uuid() || '.pdf'), '23514', null, 'the file path must belong to that client');
select throws_ok(format($$insert into public.client_documents (workspace_id, client_id, name, storage_path, content_type, size_bytes)
  values (%L, %L, 'Clip', %L, 'video/mp4', 1000)$$,
  :'ws_a', :'a1', :'ws_a' || '/' || :'a1' || '/' || gen_random_uuid() || '.mp4'), '23514', null, 'video is refused');
select throws_ok(format($$insert into public.client_documents (workspace_id, client_id, name, storage_path, content_type, size_bytes)
  values (%L, %L, 'Huge', %L, 'application/pdf', 5242881)$$,
  :'ws_a', :'a1', :'ws_a' || '/' || :'a1' || '/' || gen_random_uuid() || '.pdf'), '23514', null, 'a file over 5 MB is refused');
select throws_ok(format($$insert into public.client_documents (workspace_id, client_id, name, storage_path, content_type, size_bytes)
  values (%L, %L, '  ', %L, 'application/pdf', 1000)$$,
  :'ws_a', :'a1', :'ws_a' || '/' || :'a1' || '/' || gen_random_uuid() || '.pdf'), '23514', null, 'a document needs a name');
select throws_ok(format($$insert into public.client_documents (workspace_id, client_id, name, storage_path, content_type, size_bytes)
  values (%L, %L, 'Theirs', %L, 'application/pdf', 1000)$$,
  :'ws_b', :'b1', :'ws_b' || '/' || :'b1' || '/' || gen_random_uuid() || '.pdf'), '42501', null, 'coach cannot add a document in another workspace');
-- Storage: coach uploads for their client only.
select lives_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('client-documents', %L, %L)$$,
  :'ws_a' || '/' || :'a1' || '/' || :'f_a1' || '.pdf', :'coach_a'), 'coach uploads a file for their client');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('client-documents', %L, %L)$$,
  :'ws_b' || '/' || :'b1' || '/' || :'f_b1' || '.pdf', :'coach_a'), '42501', null, 'coach cannot upload into another workspace');
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('client-documents', %L, %L)$$,
  :'ws_a' || '/' || :'a1' || '/' || gen_random_uuid() || '.mp4', :'coach_a'), '42501', null, 'a video path is refused by storage');
reset role;
insert into storage.objects (bucket_id, name) values ('client-documents', :'ws_b' || '/' || :'b1' || '/' || :'f_b1' || '.pdf');

select tests.act_as(:'a1');
select is((select count(*)::int from public.client_documents), 0, 'the client does not see an unshared document');
select is((select count(*)::int from storage.objects where bucket_id = 'client-documents'), 0, 'nor its file');
update public.client_documents set shared_with_client = true;
select throws_ok(format($$insert into storage.objects (bucket_id, name, owner) values ('client-documents', %L, %L)$$,
  :'ws_a' || '/' || :'a1' || '/' || gen_random_uuid() || '.pdf', :'a1'), '42501', null, 'the client cannot upload');
reset role;
select is((select shared_with_client from public.client_documents where id = :'doc_a1'), false, 'the client cannot share a document themselves');

select tests.act_as(:'coach_a');
update public.client_documents set shared_with_client = true, name = 'Medical clearance 2026' where id = :'doc_a1';
select is((select name from public.client_documents where id = :'doc_a1'), 'Medical clearance 2026', 'coach renames and shares a document');
reset role;
select tests.act_as(:'a1');
select is((select count(*)::int from public.client_documents), 1, 'the client sees a shared document');
select is((select count(*)::int from storage.objects where bucket_id = 'client-documents'), 1, 'and its file');
delete from public.client_documents;
delete from storage.objects where bucket_id = 'client-documents';
reset role;
select is((select count(*)::int from public.client_documents where id = :'doc_a1'), 1, 'the client cannot delete a document');
select is((select count(*)::int from storage.objects where bucket_id = 'client-documents' and name like :'ws_a' || '/%'), 1,
  'the client cannot delete the file');
select tests.act_as(:'a2');
select is((select count(*)::int from public.client_documents) + (select count(*)::int from storage.objects where bucket_id = 'client-documents'),
  0, 'another client of the workspace sees no documents or files');
reset role;
select tests.act_as(:'coach_b');
select is((select count(*)::int from public.client_documents), 0, 'another workspace''s coach sees no documents');
select is((select count(*)::int from storage.objects where bucket_id = 'client-documents'), 1, 'coach B sees only workspace B files');
update public.client_documents set name = 'hacked';
delete from public.client_documents;
delete from storage.objects where bucket_id = 'client-documents' and name like :'ws_a' || '/%';
reset role;
select is((select count(*)::int from public.client_documents where id = :'doc_a1' and name <> 'hacked')
  + (select count(*)::int from storage.objects where bucket_id = 'client-documents' and name like :'ws_a' || '/%'), 2,
  'another workspace''s coach cannot change or delete documents or files');
select tests.act_as(:'b1');
select is((select count(*)::int from public.client_documents), 0, 'another workspace''s client sees no documents');
reset role;
select tests.act_as_anon();
select throws_ok('select * from public.client_documents', '42501', null, 'anon cannot read documents');
select is((select count(*)::int from storage.objects where bucket_id = 'client-documents'), 0, 'anon reads no files');
reset role;

-- ---------- A removed client ----------
select tests.act_as(:'coach_a');
insert into public.client_notes (workspace_id, client_id, body) values (:'ws_a', :'a2', 'Before removal');
reset role;
delete from public.workspace_members where workspace_id = :'ws_a' and user_id = :'a2';
select tests.act_as(:'coach_a');
select is((select count(*)::int from public.client_notes where client_id = :'a2'), 1, 'the coach still reads a removed client''s notes');
select throws_ok(format($$insert into public.client_notes (workspace_id, client_id, body) values (%L, %L, 'after')$$, :'ws_a', :'a2'),
  '42501', null, 'the coach cannot add notes for a removed client');
select throws_ok(format($$update public.client_goals set goal = 'after' where client_id = %L$$, :'a2'),
  '42501', null, 'the coach cannot edit a removed client''s goal');
reset role;
select tests.act_as(:'a2');
select is((select count(*)::int from public.client_goals), 0, 'a removed client no longer reads their goal');
reset role;

-- Shared document visibility ends when the client is removed.
delete from public.workspace_members where workspace_id = :'ws_a' and user_id = :'a1';
select tests.act_as(:'a1');
select is((select count(*)::int from public.client_documents) + (select count(*)::int from storage.objects where bucket_id = 'client-documents'),
  0, 'a removed client no longer sees shared documents or files');
reset role;

-- Coach deletes
select tests.add_client(:'ws_a', :'a1');
select tests.act_as(:'coach_a');
delete from public.client_notes where client_id = :'a1';
delete from public.client_documents where id = :'doc_a1';
select is((select count(*)::int from public.client_notes where client_id = :'a1')
  + (select count(*)::int from public.client_documents where id = :'doc_a1'), 0, 'the coach deletes notes and documents');
select lives_ok(format($$delete from storage.objects where bucket_id = 'client-documents' and name = %L$$,
  :'ws_a' || '/' || :'a1' || '/' || :'f_a1' || '.pdf'), 'the coach may delete the file');
reset role;

-- Deleting a workspace removes its rows by cascade.
delete from public.workspaces where id = :'ws_a';
select is((select count(*)::int from public.client_notes where workspace_id = :'ws_a')
  + (select count(*)::int from public.client_limitations where workspace_id = :'ws_a')
  + (select count(*)::int from public.client_goals where workspace_id = :'ws_a'), 0, 'deleting a workspace removes notes, limitations and goals');

select * from finish();
rollback;
