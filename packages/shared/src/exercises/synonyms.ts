/**
 * "Also known as" names for built-in exercises: the names coaches and clients use in the gym (and in
 * other apps) for exercises our library (free-exercise-db) calls something else.
 *
 * Keyed by the exact built-in name. Built-in names are pinned by scripts/import-exercises.ts, and the
 * search index does not carry the library id, so the name is the stable key. A test checks that every
 * key is a real library name.
 *
 * In search an other name works like the real name: typing it in full ranks the exercise first, and
 * word, prefix and typo matching work on it too. Custom exercises never get these names.
 *
 * Plain data: adding a name is a one-line change. Do not list a name here that is (or will be) a
 * built-in exercise of its own.
 */
export const EXERCISE_OTHER_NAMES: Readonly<Record<string, readonly string[]>> = {
  // Chest
  'Barbell Bench Press - Medium Grip': ['Bench Press', 'Flat Bench Press', 'Barbell Bench Press', 'Flat Barbell Bench Press'],
  'Barbell Incline Bench Press - Medium Grip': ['Incline Bench Press', 'Incline Barbell Bench Press', 'Incline Barbell Press'],
  'Incline Dumbbell Press': ['Incline Dumbbell Bench Press', 'Dumbbell Incline Press', 'Dumbbell Incline Bench Press'],
  'Decline Barbell Bench Press': ['Decline Bench Press'],
  'Close-Grip Barbell Bench Press': ['Close Grip Bench Press'],
  'Leverage Chest Press': ['Chest Press Machine', 'Machine Chest Press', 'Chest Press'],
  Butterfly: ['Pec Deck', 'Pec Deck Fly', 'Machine Fly', 'Machine Chest Fly'],
  'Cable Crossover': ['Cable Fly', 'Cable Chest Fly', 'Cable Flyes'],
  'Low Cable Crossover': ['Low To High Cable Fly'],
  'Dumbbell Flyes': ['Dumbbell Chest Fly', 'Dumbbell Fly', 'Chest Fly'],
  Pushups: ['Push Up', 'Push Ups'],
  'Push-Ups - Close Triceps Position': ['Diamond Push Up', 'Diamond Push Ups'],
  'Dips - Chest Version': ['Chest Dips', 'Chest Dip'],
  'Straight-Arm Dumbbell Pullover': ['Dumbbell Pullover'],
  // Back
  'Barbell Deadlift': ['Deadlift', 'Conventional Deadlift'],
  'Trap Bar Deadlift': ['Hex Bar Deadlift'],
  Pullups: ['Pull Up', 'Pull Ups'],
  'Band Assisted Pull-Up': ['Assisted Pull Up'],
  'Bent Over Barbell Row': ['Barbell Row', 'Bent Over Row', 'Pendlay Row'],
  'One-Arm Dumbbell Row': ['Dumbbell Row', 'Single Arm Dumbbell Row'],
  'Dumbbell Incline Row': ['Chest Supported Row', 'Chest Supported Dumbbell Row'],
  'Seated Cable Rows': ['Seated Cable Row', 'Cable Row', 'Seated Row'],
  'Wide-Grip Lat Pulldown': ['Lat Pulldown', 'Lat Pull Down', 'Cable Lat Pulldown'],
  'Inverted Row': ['Australian Pull Up', 'Bodyweight Row'],
  // Shoulders
  'Standing Military Press': ['Overhead Press', 'Barbell Overhead Press', 'Military Press'],
  'Seated Dumbbell Press': ['Seated Dumbbell Shoulder Press', 'Dumbbell Seated Overhead Press', 'Dumbbell Seated Shoulder Press'],
  'Arnold Dumbbell Press': ['Arnold Press'],
  'Side Lateral Raise': ['Lateral Raise', 'Dumbbell Lateral Raise', 'Side Raise', 'Dumbbell Side Raise'],
  'Standing Low-Pulley Deltoid Raise': ['Cable Lateral Raise'],
  'Front Dumbbell Raise': ['Front Raise', 'Dumbbell Front Raise'],
  'Reverse Flyes': ['Rear Delt Fly', 'Reverse Fly', 'Dumbbell Rear Delt Fly'],
  'Reverse Machine Flyes': ['Reverse Pec Deck', 'Rear Delt Machine Fly'],
  // Arms
  'Standing Biceps Cable Curl': ['Cable Curl', 'Cable Bicep Curl'],
  'Reverse Barbell Curl': ['Reverse Curl'],
  'Seated Palm-Up Barbell Wrist Curl': ['Wrist Curl'],
  'Dumbbell Bicep Curl': ['Bicep Curl', 'Biceps Curl', 'Dumbbell Curl'],
  'Dumbbell Alternate Bicep Curl': ['Alternating Dumbbell Bicep Curl', 'Alternating Dumbbell Curl'],
  'Concentration Curls': ['Dumbbell Concentration Curl'],
  'Triceps Pushdown': ['Cable Tricep Pushdown', 'Tricep Pushdown', 'Cable Pushdown'],
  'Triceps Pushdown - Rope Attachment': ['Rope Pushdown', 'Tricep Rope Pushdown'],
  'EZ-Bar Skullcrusher': ['Skull Crusher', 'Skull Crushers'],
  'Standing Dumbbell Triceps Extension': ['Overhead Tricep Extension', 'Dumbbell Overhead Tricep Extension'],
  'Dips - Triceps Version': ['Dips', 'Tricep Dips', 'Parallel Bar Dips'],
  // Legs and glutes
  'Barbell Squat': ['Back Squat', 'Barbell Back Squat'],
  'Front Barbell Squat': ['Front Squat'],
  'Bodyweight Squat': ['Air Squat'],
  'Split Squat with Dumbbells': ['Bulgarian Split Squat', 'Rear Foot Elevated Split Squat'],
  'Dumbbell Lunges': ['Lunges', 'Lunge', 'Forward Lunge'],
  'Dumbbell Rear Lunge': ['Reverse Lunge'],
  'Dumbbell Step Ups': ['Step Up', 'Step Ups'],
  'Lying Leg Curls': ['Leg Curl', 'Hamstring Curl', 'Lying Hamstring Curl'],
  'Natural Glute Ham Raise': ['Nordic Curl', 'Nordic Hamstring Curl'],
  'Butt Lift (Bridge)': ['Glute Bridge', 'Hip Bridge'],
  'Thigh Abductor': ['Hip Abduction Machine', 'Hip Abduction'],
  'Thigh Adductor': ['Hip Adduction Machine', 'Hip Adduction'],
  'Standing Calf Raises': ['Calf Raise', 'Calf Raises'],
  'Calf Press On The Leg Press Machine': ['Calf Raise On Leg Press', 'Leg Press Calf Raise', 'Leg Press Calf Raises'],
  // Core
  'Side Bridge': ['Side Plank'],
  Crunches: ['Crunch'],
  'Air Bike': ['Bicycle Crunch', 'Bicycle Crunches'],
  'Ab Roller': ['Ab Wheel', 'Ab Wheel Rollout'],
  'Flat Bench Lying Leg Raise': ['Leg Raise', 'Lying Leg Raise'],
  'Standing Cable Wood Chop': ['Wood Chop', 'Cable Wood Chop'],
  // Full body and conditioning
  'Overhead Slam': ['Medicine Ball Slam', 'Ball Slam'],
  'Standing Two-Arm Overhead Throw': ['Medicine Ball Standing Overhead Throw', 'Medicine Ball Overhead Throw'],
  'One-Arm Kettlebell Swings': ['Kettlebell Swing'],
  'Kettlebell Turkish Get-Up (Lunge style)': ['Turkish Get Up'],
  'Front Box Jump': ['Box Jump', 'Box Jumps'],
  "Farmer's Walk": ['Farmers Walk', 'Farmers Carry'],
  'Battling Ropes': ['Battle Ropes'],
  'Rope Jumping': ['Jump Rope', 'Skipping'],
  'Running, Treadmill': ['Treadmill'],
  'Rowing, Stationary': ['Rowing Machine', 'Rower'],
  'Bicycling, Stationary': ['Exercise Bike', 'Stationary Bike'],
};
