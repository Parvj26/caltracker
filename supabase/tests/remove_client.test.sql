begin;
select plan(30);

select tests.create_user('rc-coach@t.local', 'Rc Coach') as coach \gset
select tests.create_workspace('RC Coaching', :'coach') as ws \gset
select tests.create_user('rc-coach2@t.local', 'Other Coach') as coach2 \gset
select tests.create_workspace('RC Other', :'coach2') as ws2 \gset
select tests.create_user('rc-sam@t.local', 'Sam Lee') as sam \gset
select tests.add_client(:'ws', :'sam');
select tests.create_user('rc-kim@t.local', 'Kim Park') as kim \gset
select tests.add_client(:'ws', :'kim');

-- Privileges.
select ok(not has_function_privilege('anon', 'public.remove_client(uuid, uuid)', 'execute'), 'anon cannot call remove_client');
select ok(has_function_privilege('authenticated', 'public.remove_client(uuid, uuid)', 'execute'),
  'signed-in users can call remove_client (it checks the coach itself)');
select ok(not has_table_privilege('authenticated', 'public.past_clients', 'insert,update,delete'),
  'past_clients is written only by remove_client');

-- Only a coach of that workspace can remove.
select tests.act_as(:'coach2');
select throws_ok(format('select public.remove_client(%L, %L)', :'ws', :'sam'), '42501', null,
  'a coach of another workspace cannot remove the client');
reset role;
select tests.act_as(:'kim');
select throws_ok(format('select public.remove_client(%L, %L)', :'ws', :'sam'), '42501', null,
  'a client cannot remove another client');
select throws_ok(format('select public.remove_client(%L, %L)', :'ws', :'kim'), '42501', null,
  'a client cannot remove themselves');
reset role;
select tests.act_as(:'coach');
select throws_ok(format('select public.remove_client(%L, %L)', :'ws', :'coach'), 'P0002', null,
  'only clients can be removed (not the owner)');
select throws_ok(format('select public.remove_client(%L, %L)', :'ws', :'coach2'), 'P0002', null,
  'someone who is not a client of this workspace cannot be removed');

-- The coach removes Sam.
select lives_ok(format('select public.remove_client(%L, %L)', :'ws', :'sam'), 'the coach removes Sam');
select results_eq(
  format($$select email, first_name, last_name, removed_by from public.past_clients where workspace_id = %L and user_id = %L$$,
    :'ws', :'sam'),
  format($$values ('rc-sam@t.local'::text, 'Sam'::text, 'Lee'::text, %L::uuid)$$, :'coach'),
  'Sam is listed under past clients, with name and email kept');
select is((select count(*)::int from public.workspace_members where workspace_id = :'ws' and user_id = :'sam'), 0,
  'Sam no longer has a membership');
reset role;

-- Sam has lost access.
select tests.act_as(:'sam');
select ok(not public.is_member_of(:'ws'), 'Sam is no longer a member');
select is((select count(*)::int from public.workspaces where id = :'ws'), 0, 'Sam cannot read the workspace');
select is((select count(*)::int from public.profiles where id = :'coach'), 0, 'Sam cannot read the coach''s profile');
select is((select count(*)::int from public.past_clients), 0, 'Sam cannot read the past clients list');
select results_eq('select workspace_name from public.my_removal()', $$values ('RC Coaching'::text)$$,
  'Sam''s app can tell he was removed, and by which coach');
reset role;
select tests.act_as(:'kim');
select is((select count(*)::int from public.my_removal()), 0, 'a current client has no removal');
reset role;

-- Other coaches cannot see the list.
select tests.act_as(:'coach2');
select is((select count(*)::int from public.past_clients), 0, 'another coach cannot see RC''s past clients');
reset role;

-- Removing twice is harmless to the record but reports not found.
select tests.act_as(:'coach');
select throws_ok(format('select public.remove_client(%L, %L)', :'ws', :'sam'), 'P0002', null,
  'removing an already removed client reports not found');
reset role;

-- Re-invite restores: claiming the new invite links Sam again and clears the past-client row.
select tests.create_invite(:'ws', 'rc-sam@t.local', 'Sam Lee', :'coach', 'tok-rc-sam-000000000000') as inv \gset
select tests.act_as(:'sam');
select results_eq('select workspace_name from public.claim_invites()', $$values ('RC Coaching'::text)$$,
  'Sam claims the new invite');
select is((select count(*)::int from public.my_removal()), 0, 'Sam is no longer shown as removed');
reset role;
select is((select count(*)::int from public.past_clients where user_id = :'sam'), 0,
  'Sam left the past clients list');

-- A removed client can join a different coach.
select tests.act_as(:'coach');
select lives_ok(format('select public.remove_client(%L, %L)', :'ws', :'kim'), 'the coach removes Kim');
reset role;
select tests.create_invite(:'ws2', 'rc-kim@t.local', 'Kim Park', :'coach2', 'tok-rc-kim-000000000000') as inv2 \gset
select tests.act_as(:'kim');
select results_eq('select workspace_name from public.claim_invites()', $$values ('RC Other'::text)$$,
  'Kim joins the other coach');
reset role;


-- Staff can remove too.
select tests.create_user('rc-staff@t.local', 'Staff Person') as staff \gset
insert into public.workspace_members (workspace_id, user_id, role) values (:'ws', :'staff', 'staff');
select tests.create_user('rc-lee@t.local', 'Lee Ray') as lee \gset
select tests.add_client(:'ws', :'lee');
select tests.act_as(:'staff');
select lives_ok(format('select public.remove_client(%L, %L)', :'ws', :'lee'), 'a staff member can remove a client');
reset role;

-- Re-joining through the invite link (accept_invite_for) also clears the record.
select tests.create_invite(:'ws', 'rc-lee@t.local', 'Lee Ray', :'coach', 'tok-rc-lee-000000000000') as inv3 \gset
select is(public.accept_invite_for(:'inv3', :'lee'), 'ok', 'Lee joins again from the invite link');
select is((select count(*)::int from public.past_clients where user_id = :'lee'), 0,
  'joining from the invite link clears the past-client record');

-- After joining another coach, the old removal is no longer reported.
select tests.act_as(:'kim');
select is((select count(*)::int from public.my_removal()), 0, 'Kim, now with another coach, is not shown as removed');
reset role;

-- Cancel invite: a coach can delete a pending invite but never an accepted one.
select tests.create_invite(:'ws', 'rc-new@t.local', 'New Person', :'coach', 'tok-rc-new-000000000000') as inv4 \gset
select tests.act_as(:'coach');
with d as (delete from public.client_invites where id = :'inv3' returning 1)
select is((select count(*)::int from d), 0, 'an accepted invite cannot be deleted');
with d as (delete from public.client_invites where id = :'inv4' returning 1)
select is((select count(*)::int from d), 1, 'a pending invite can be cancelled');
reset role;

select * from finish();
rollback;
