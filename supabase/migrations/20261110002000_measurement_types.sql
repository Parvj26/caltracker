-- Measurements per workout exercise (Weight / Reps / Time). A coach can now pick, for one exercise in one workout,
-- any non-empty mix of the three. The mixes that weren't a tracking type yet become one, so every function and app
-- that reads a tracking type follows the pick unchanged. They are only for workout and log exercises: the next
-- migration keeps the library on its five kinds. Adding an enum value must be committed before rows can use it,
-- so everything that uses them is in the next migration.
alter type public.tracking_type add value if not exists 'weight';
alter type public.tracking_type add value if not exists 'reps_time';
alter type public.tracking_type add value if not exists 'weight_reps_time';
