begin;
select plan(80);

select tests.create_user('ms-coach@t.local', 'Ms Coach') as coach \gset
select tests.create_workspace('MS Coaching', :'coach') as ws \gset
select tests.create_user('ms-coach2@t.local', 'Other Coach') as coach2 \gset
select tests.create_workspace('MS Other', :'coach2') as ws2 \gset
select tests.create_user('ms-sam@t.local', 'Sam Lee') as sam \gset
select tests.add_client(:'ws', :'sam');
select tests.create_user('ms-kim@t.local', 'Kim Park') as kim \gset
select tests.add_client(:'ws', :'kim');
select tests.create_user('ms-lee@t.local', 'Lee Other') as lee \gset
select tests.add_client(:'ws2', :'lee');

-- Privileges and structure.
select ok(not has_function_privilege('anon', 'public.get_or_create_conversation(uuid)', 'execute'), 'anon cannot call get_or_create_conversation');
select ok(not has_function_privilege('anon', 'public.mark_conversation_read(uuid)', 'execute'), 'anon cannot call mark_conversation_read');
select ok(not has_table_privilege('anon', 'public.messages', 'select'), 'anon has no access to messages');
select ok(not has_table_privilege('authenticated', 'public.messages', 'update,delete'), 'messages cannot be edited or deleted');
select ok(not has_any_column_privilege('authenticated', 'public.messages', 'update'), 'no column of messages is updatable');
select ok(not has_column_privilege('authenticated', 'public.messages', 'sender_id', 'insert'), 'sender_id has no insert privilege');
select ok(not has_table_privilege('authenticated', 'public.conversation_reads', 'insert,update,delete'), 'reads are written only by mark_conversation_read');
select ok(not has_table_privilege('authenticated', 'public.conversations', 'insert,update,delete'), 'conversations are created only by get_or_create_conversation');

select ok(not has_column_privilege('authenticated', 'public.messages', 'workspace_id', 'insert'), 'workspace_id has no insert privilege');
select ok(not has_column_privilege('authenticated', 'public.messages', 'created_at', 'insert'), 'created_at has no insert privilege');
select ok(not has_column_privilege('authenticated', 'public.messages', 'id', 'insert'), 'id has no insert privilege');

-- get_or_create_conversation.
select tests.act_as(:'coach');
select public.get_or_create_conversation(:'sam') as conv \gset
select ok(:'conv' is not null, 'the coach gets a conversation for Sam');
select is(public.get_or_create_conversation(:'sam'), :'conv'::uuid, 'calling it twice returns the same conversation');
select throws_ok(format('select public.get_or_create_conversation(%L)', :'lee'), '42501', null, 'a coach cannot open a conversation with another coach''s client');
select throws_ok(format('select public.get_or_create_conversation(%L)', :'coach2'), '42501', null, 'a coach cannot open a conversation with a non-client');
reset role;
select tests.act_as(:'sam');
select is(public.get_or_create_conversation(:'sam'), :'conv'::uuid, 'Sam gets the same conversation');
select throws_ok(format('select public.get_or_create_conversation(%L)', :'kim'), '42501', null, 'a client cannot open a conversation for another client');
reset role;
select tests.act_as(:'lee');
select throws_ok(format('select public.get_or_create_conversation(%L)', :'sam'), '42501', null, 'another coach''s client cannot open Sam''s conversation');
reset role;
select tests.act_as(:'kim');
select public.get_or_create_conversation(:'kim') as kconv \gset
select isnt(:'kconv'::uuid, :'conv'::uuid, 'Kim has her own conversation');
reset role;

-- Sending.
select tests.act_as(:'sam');
select lives_ok(format($$insert into public.messages (conversation_id, body, client_msg_id) values (%L, 'Hi coach', '11111111-1111-1111-1111-111111111111')$$, :'conv'),
  'Sam sends a message');
select throws_ok(format($$insert into public.messages (conversation_id, sender_id, body) values (%L, %L, 'spoof')$$, :'conv', :'coach'),
  '42501', null, 'Sam cannot send as the coach');
select throws_ok(format($$insert into public.messages (conversation_id, body) values (%L, 'wrong chat')$$, :'kconv'),
  '42501', null, 'Sam cannot send into Kim''s conversation');
select throws_ok(format($$insert into public.messages (conversation_id, body, client_msg_id) values (%L, 'again', '11111111-1111-1111-1111-111111111111')$$, :'conv'),
  '23505', null, 'a duplicate client_msg_id is refused');
select lives_ok(format($$insert into public.messages (conversation_id, body, client_msg_id) values (%L, 'again', '11111111-1111-1111-1111-111111111111') on conflict do nothing$$, :'conv'),
  'a retry with on conflict do nothing is a no-op');
select is((select count(*)::int from public.messages where conversation_id = :'conv'), 1, 'the retry added no second message');
select throws_ok(format($$insert into public.messages (conversation_id, body) values (%L, '')$$, :'conv'), '23514', null, 'empty body with no images is rejected');
select throws_ok(format($$insert into public.messages (conversation_id, body) values (%L, E'  \n ')$$, :'conv'), '23514', null, 'whitespace body with no images is rejected');
select throws_ok(format($$insert into public.messages (conversation_id, body) values (%L, repeat('a', 4001))$$, :'conv'), '23514', null, 'a body over 4000 characters is rejected');
select lives_ok(format($$insert into public.messages (conversation_id, body) values (%L, repeat('a', 4000))$$, :'conv'), 'a body of 4000 characters is accepted');
select throws_ok(
  format($$insert into public.messages (conversation_id, image_paths) values (%L, array[%s])$$, :'conv',
    (select string_agg(quote_literal(:'ws' || '/' || :'conv' || '/' || n || '.webp'), ',') from generate_series(1, 5) n)),
  '23514', null, 'five images are rejected');
select lives_ok(
  format($$insert into public.messages (conversation_id, image_paths) values (%L, array[%s])$$, :'conv',
    (select string_agg(quote_literal(:'ws' || '/' || :'conv' || '/' || n || '.webp'), ',') from generate_series(1, 4) n)),
  'four images with no text are accepted');
select throws_ok(format($$insert into public.messages (conversation_id, image_paths) values (%L, array['x/y/z.webp'])$$, :'conv'),
  '23514', null, 'an image path outside the conversation''s folder is rejected');
reset role;

-- Outsiders cannot send into Sam's conversation.
select tests.act_as(:'coach2');
select throws_ok(format($$insert into public.messages (conversation_id, body) values (%L, 'intruder')$$, :'conv'), '42501', null, 'another coach cannot send into the conversation');
select throws_ok(format('select public.mark_conversation_read(%L)', :'conv'), '42501', null, 'another coach cannot mark the conversation read');
reset role;
select tests.act_as(:'lee');
select throws_ok(format($$insert into public.messages (conversation_id, body) values (%L, 'intruder')$$, :'conv'), '42501', null, 'another workspace''s client cannot send into the conversation');
reset role;
select tests.act_as_anon();
select throws_ok(format($$insert into public.messages (conversation_id, body) values (%L, 'intruder')$$, :'conv'), '42501', null, 'anon cannot send');
reset role;

select tests.act_as(:'coach');
select lives_ok(format($$insert into public.messages (conversation_id, body) values (%L, 'Hi Sam')$$, :'conv'), 'the coach replies');
reset role;
select is((select workspace_id from public.messages where body = 'Hi Sam'), :'ws'::uuid, 'the workspace is copied from the conversation');
select is((select sender_id from public.messages where body = 'Hi Sam'), :'coach'::uuid, 'the sender is the caller');
select is((select last_message_at from public.conversations where id = :'conv'), (select max(created_at) from public.messages where conversation_id = :'conv'),
  'last_message_at follows the newest message');

-- Reading.
select tests.act_as(:'sam');
select is((select count(*)::int from public.messages where conversation_id = :'conv'), 4, 'Sam reads his conversation');
select is((select count(*)::int from public.conversations), 1, 'Sam sees only his conversation');
reset role;
select tests.act_as(:'coach');
select is((select count(*)::int from public.messages where conversation_id = :'conv'), 4, 'the coach reads the conversation');
reset role;
select tests.act_as(:'kim');
select is((select count(*)::int from public.messages where conversation_id = :'conv'), 0, 'another client in the workspace cannot read Sam''s messages');
select is((select count(*)::int from public.conversations where id = :'conv'), 0, 'another client cannot see Sam''s conversation');
reset role;
select tests.act_as(:'coach2');
select is((select count(*)::int from public.messages), 0, 'another coach reads no messages');
select is((select count(*)::int from public.conversations), 0, 'another coach sees no conversations');
reset role;
select tests.act_as_anon();
select throws_ok('select count(*) from public.messages', '42501', null, 'anon cannot read messages');
select throws_ok('select count(*) from public.conversations', '42501', null, 'anon cannot read conversations');
select throws_ok('select count(*) from public.conversation_reads', '42501', null, 'anon cannot read conversation reads');
reset role;

-- Reads.
select tests.act_as(:'kim');
select throws_ok(format('select public.mark_conversation_read(%L)', :'conv'), '42501', null, 'another client cannot mark Sam''s conversation read');
reset role;
select tests.act_as(:'sam');
select lives_ok(format('select public.mark_conversation_read(%L)', :'conv'), 'Sam marks the conversation read');
reset role;
select tests.act_as(:'coach');
select is((select count(*)::int from public.conversation_reads where conversation_id = :'conv' and user_id = :'sam'), 1, 'the coach sees Sam''s read (Seen)');
reset role;
select tests.act_as(:'kim');
select is((select count(*)::int from public.conversation_reads), 0, 'another client cannot see Sam''s read');
reset role;
select tests.act_as(:'coach2');
select is((select count(*)::int from public.conversation_reads), 0, 'another coach cannot see Sam''s read');
reset role;

-- Storage.
select tests.act_as(:'sam');
select lives_ok(format($$insert into storage.objects (bucket_id, name) values ('message-images', %L)$$, :'ws' || '/' || :'conv' || '/a.webp'),
  'Sam uploads into his conversation folder');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('message-images', %L)$$, :'ws' || '/' || :'kconv' || '/a.webp'),
  '42501', null, 'Sam cannot upload into Kim''s conversation folder');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('message-images', 'junk/a.webp')$$, '42501', null, 'a malformed path is refused');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('message-images', %L)$$, :'ws2' || '/' || :'conv' || '/m.webp'),
  '42501', null, 'a path with a mismatched workspace folder is refused');
reset role;
select tests.act_as(:'coach');
select lives_ok(format($$insert into storage.objects (bucket_id, name) values ('message-images', %L)$$, :'ws' || '/' || :'conv' || '/b.webp'),
  'the coach uploads into the conversation folder');
reset role;
select tests.act_as(:'sam');
select is((select count(*)::int from storage.objects where bucket_id = 'message-images'), 2, 'Sam reads both photos');
reset role;
select tests.act_as(:'kim');
select is((select count(*)::int from storage.objects where bucket_id = 'message-images'), 0, 'another client reads no photos');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('message-images', %L)$$, :'ws' || '/' || :'conv' || '/c.webp'),
  '42501', null, 'another client cannot upload into Sam''s folder');
reset role;
select tests.act_as(:'coach2');
select is((select count(*)::int from storage.objects where bucket_id = 'message-images'), 0, 'another coach reads no photos');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('message-images', %L)$$, :'ws' || '/' || :'conv' || '/c.webp'),
  '42501', null, 'another coach cannot upload');
reset role;
select tests.act_as_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'message-images'), 0, 'anon reads no photos');
reset role;

-- Removed client: history stays readable to the coach, nobody can post.
select tests.act_as(:'coach');
select public.remove_client(:'ws', :'sam');
reset role;
select tests.act_as(:'coach');
select is((select count(*)::int from public.messages where conversation_id = :'conv'), 4, 'the coach still reads the removed client''s history');
select is((select count(*)::int from public.conversations where id = :'conv'), 1, 'the coach still sees the removed client''s conversation');
select throws_ok(format($$insert into public.messages (conversation_id, body) values (%L, 'hello?')$$, :'conv'), '42501', null, 'the coach cannot message a removed client');
select throws_ok(format($$insert into storage.objects (bucket_id, name) values ('message-images', %L)$$, :'ws' || '/' || :'conv' || '/d.webp'),
  '42501', null, 'the coach cannot upload to a removed client''s conversation');
select is((select count(*)::int from storage.objects where bucket_id = 'message-images'), 2, 'the coach still reads the removed client''s photos');
select throws_ok(format('select public.get_or_create_conversation(%L)', :'sam'), '42501', null, 'no conversation can be opened for a removed client');
reset role;
select tests.act_as(:'sam');
select is((select count(*)::int from public.messages), 0, 'the removed client reads nothing');
select is((select count(*)::int from public.conversations), 0, 'the removed client sees no conversations');
select is((select count(*)::int from storage.objects where bucket_id = 'message-images'), 0, 'the removed client reads no photos');
select throws_ok(format($$insert into public.messages (conversation_id, body) values (%L, 'still here?')$$, :'conv'), '42501', null, 'the removed client cannot send');
select throws_ok(format('select public.mark_conversation_read(%L)', :'conv'), '42501', null, 'the removed client cannot mark read');
reset role;

-- Re-joining brings the history back.
select tests.add_client(:'ws', :'sam');
select tests.act_as(:'sam');
select is((select count(*)::int from public.messages where conversation_id = :'conv'), 4, 'a re-joined client sees the history again');
select lives_ok(format($$insert into public.messages (conversation_id, body) values (%L, 'back')$$, :'conv'), 'a re-joined client can send again');
reset role;

-- Realtime.
select is((select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
  and tablename in ('messages', 'conversation_reads')), 2, 'messages and conversation_reads are in the realtime publication');

select * from finish();
rollback;
