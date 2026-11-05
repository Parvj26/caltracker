-- The launch market is the US: new accounts (coaches and clients) start in pounds, and distances in miles
-- (distance follows the weight setting). Existing accounts keep whatever they chose; anyone can switch.
alter table public.profiles alter column units set default 'lb';
