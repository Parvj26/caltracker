-- Built-in library fixes, by free-exercise-db id (external_id). The same ids and types are in
-- scripts/exercise-tracking-overrides.json so a fresh import agrees; a unit test checks the two match.
--   Arm Circles: reps (was time, from its "stretching" category).
--   Farmer's Walk: weight and time (was distance).
-- Only the exercise's tracking type changes. Planned and logged sets are left exactly as they are: a value the new
-- type doesn't use (a Farmer's Walk distance, an Arm Circles time) stays stored, it's just no longer shown.
update public.exercises e
set tracking_type = v.tracking_type::public.tracking_type
from (values
  ('Arm_Circles', 'reps'),
  ('Farmers_Walk', 'weight_time')
) as v(external_id, tracking_type)
where e.source = 'builtin' and e.external_id = v.external_id;
