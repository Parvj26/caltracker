-- A fifth tracking type for loaded carries and holds (Farmer's Walk): the client logs a weight and how long they
-- carried it. Sets already have target_weight_kg/target_duration_s and actual_weight_kg/actual_duration_s, so no
-- column changes. Adding an enum value must be committed before rows can use it, so the library update that uses
-- it is the next migration.
alter type public.tracking_type add value if not exists 'weight_time';
