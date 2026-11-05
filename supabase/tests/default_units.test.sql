begin;
select plan(2);

-- The launch market is the US: new accounts (coaches and clients) start in pounds; anyone can switch to kg.
select col_default_is('public', 'profiles', 'units', 'lb'::text, 'profiles.units defaults to lb');
select tests.create_user('du-new@t.local', 'New Person') as new_user \gset
select is((select units from public.profiles where id = :'new_user'), 'lb', 'a brand-new account starts in pounds');

select * from finish();
rollback;
