-- Pick-one groups: a workout or log block may now be a 'choice' (the client picks one of 2 to 5 exercises).
-- Its own migration because Postgres cannot use a new enum value in the transaction that adds it; the columns,
-- checks and functions that use it follow in 20261106001000_sections_and_choices.sql.
alter type public.block_kind add value 'choice';
