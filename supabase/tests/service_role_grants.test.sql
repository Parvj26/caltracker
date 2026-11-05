begin;
select plan(14);

select table_privs_are('public', 'profiles', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly select/insert/update/delete on profiles');
select table_privs_are('public', 'workspaces', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly select/insert/update/delete on workspaces');
select table_privs_are('public', 'workspace_members', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly select/insert/update/delete on workspace_members');
select table_privs_are('public', 'client_invites', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly select/insert/update/delete on client_invites');
select table_privs_are('public', 'exercises', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly select/insert/update/delete on exercises');
select table_privs_are('public', 'exercise_overrides', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly select/insert/update/delete on exercise_overrides');

select table_privs_are('public', 'workouts', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly select/insert/update/delete on workouts');
select table_privs_are('public', 'workout_blocks', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly select/insert/update/delete on workout_blocks');
select table_privs_are('public', 'workout_exercises', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly select/insert/update/delete on workout_exercises');
select table_privs_are('public', 'workout_sets', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly select/insert/update/delete on workout_sets');

select table_privs_are('public', 'programs', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly select/insert/update/delete on programs');
select table_privs_are('public', 'program_workouts', 'service_role', array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  'service_role has exactly select/insert/update/delete on program_workouts');

-- M2: coaches (authenticated) cannot write client_invites at all.
select ok(not has_any_column_privilege('authenticated', 'public.client_invites', 'insert')
  and not has_any_column_privilege('authenticated', 'public.client_invites', 'update'),
  'authenticated has no insert/update privilege on client_invites');
select table_privs_are('public', 'client_invites', 'authenticated', array['SELECT', 'DELETE'],
  'authenticated has exactly select/delete on client_invites');

select * from finish();
rollback;
