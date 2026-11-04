# CalTracker Sticker Collection

The source of truth for the collection. The product spec (Section 6) defines the rules, and this file holds the content. Weights are rounded typical adult weights, chosen to be memorable rather than precise.

## Tiers at a glance
| Tier | Count | How it's earned | Frame in app |
|---|---|---|---|
| Common | 10 | Workout volume reaches the animal (ladder) | White die-cut ring |
| Exotic | 20 | Workout volume reaches the animal (ladder) | White ring + lime edge |
| Rare find | 10 | Specific achievement | White ring + pink edge + "RARE" tag |
| Ultra-rare | 3 | 1-in-100 random drop per qualifying workout | Gold edge + sparkle + "ULTRA-RARE" tag |
| Shiny | any ladder animal | 1-in-20 roll each time a workout earns its ladder animal | Animated holographic foil overlay |

## 1. Weight ladder (Common + Exotic) — 30 animals
After each workout, the badge shows the heaviest animal whose weight ≤ workout volume, with the multiple ("You lifted 2.1 rhinos!").

| # | Animal | Weight (kg) | Tier |
|---|---|---|---|
| 1 | Rabbit | 2 | Common |
| 2 | Cat | 4 | Common |
| 3 | Red panda | 5 | Exotic |
| 4 | Koala | 9 | Exotic |
| 5 | Corgi | 12 | Common |
| 6 | Emperor penguin | 30 | Exotic |
| 7 | Golden retriever | 32 | Common |
| 8 | Snow leopard | 45 | Exotic |
| 9 | Capybara | 55 | Exotic |
| 10 | Goat | 65 | Common |
| 11 | Sheep | 80 | Common |
| 12 | Kangaroo | 85 | Exotic |
| 13 | Giant panda | 110 | Exotic |
| 14 | Pig | 150 | Common |
| 15 | Gorilla | 170 | Exotic |
| 16 | Lion | 190 | Exotic |
| 17 | Polar bear | 450 | Exotic |
| 18 | Horse | 500 | Common |
| 19 | Moose | 550 | Exotic |
| 20 | Cow | 700 | Common |
| 21 | Bison | 900 | Exotic |
| 22 | Walrus | 1,000 | Exotic |
| 23 | Giraffe | 1,200 | Exotic |
| 24 | Hippo | 1,500 | Exotic |
| 25 | Rhino | 2,300 | Exotic |
| 26 | Elephant | 4,000 | Common |
| 27 | Orca | 6,000 | Exotic |
| 28 | Whale shark | 19,000 | Exotic |
| 29 | Humpback whale | 30,000 | Exotic |
| 30 | Blue whale | 150,000 | Exotic |

Typical strength sessions land between 2,000 and 15,000 kg, so the 1,000–19,000 kg band has the most variety. The biggest whales are long-term goals for lifetime and monthly totals.

## 2. Rare finds (achievement-based) — 10 animals
| Animal | Requirement |
|---|---|
| Axolotl | 10 completed workouts |
| Quokka | 4-week streak |
| Fennec fox | 5 personal bests |
| Pangolin | 25 completed workouts |
| Okapi | 12-week streak |
| Snowy owl | 25 personal bests |
| Pink fairy armadillo | 100,000 kg lifetime volume |
| White tiger | 50 completed workouts |
| Golden snub-nosed monkey | 26-week streak |
| Narwhal | 1,000,000 kg lifetime volume |

Locked rare finds appear in the sticker book as a silhouette with their requirement and progress ("Okapi — 12-week streak · you're at 7").

## 3. Ultra-rare random drops — 3 animals
| Animal | Chance |
|---|---|
| Pink river dolphin | 1-in-100 per qualifying workout (drawn from those not yet owned) |
| Kākāpō | same |
| White peacock | same |

Locked ultra-rares show as "???" in the sticker book. Nobody knows which animals they are until someone finds one, which gives the community something to talk about.

## 4. Repeats and shiny variants
- Every time a workout earns a ladder animal again, its count goes up and the sticker shows **×N** (product owner decision, 2026-11-04).
- Each time a qualifying workout earns its ladder animal, roll 1-in-20 for a shiny version (only if not already owned shiny).
- Shiny stickers use the same art with an animated holographic foil overlay in the app, plus a "Shiny!" label.
- The sticker book shows the shiny count: "Shiny: 4 / 30".

## 5. Distance landmarks (distance badges)
Ordered smallest to largest. All values are source-checked (see the change log for contested figures).

| Landmark | Measure (m) |
|---|---|
| Chichén Itzá, El Castillo (height) | 30 |
| Christ the Redeemer, incl. pedestal (height) | 38 |
| Petra, the Treasury (height) | 40 |
| Colosseum (height) | 49 |
| Taj Mahal (height) | 73 |
| Statue of Liberty (height) | 93 |
| Big Ben tower (height) | 96 |
| Great Pyramid of Giza (height today) | 138 |
| Eiffel Tower (height) | 330 |
| Empire State Building (height) | 443 |
| Burj Khalifa (height) | 828 |
| Machu Picchu (altitude) | 2,430 |
| Golden Gate Bridge (length) | 2,737 |
| Mount Fuji (height) | 3,776 |
| Mount Everest (height) | 8,849 |
| Marathon | 42,195 |
| Great Wall of China (length, lifetime goal) | 21,196,000 |

## Qualifying workout
A completed workout with at least 5 completed sets. This applies to random drops and shiny rolls. Coach-logged workouts count.

## Placeholders during development
Until the AI-generated art is ready, the app uses Microsoft Fluent Emoji (flat, MIT-licensed; licence to be confirmed from the official repo before use) where an emoji exists. Otherwise it shows a neutral paw placeholder.
