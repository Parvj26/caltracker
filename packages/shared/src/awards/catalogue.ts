export type StickerKind = 'ladder' | 'rare' | 'drop' | 'landmark';

export type RareRequirement =
  | { kind: 'workouts'; value: number }
  | { kind: 'streak'; value: number }
  | { kind: 'prs'; value: number }
  | { kind: 'volume'; value: number };

export type StickerDef = {
  key: string;
  kind: StickerKind;
  name: string;
  weightKg?: number;
  tier?: 'common' | 'exotic';
  requirement?: RareRequirement;
  fact: string;
};

const L = (
  key: string,
  name: string,
  weightKg: number,
  tier: 'common' | 'exotic',
  fact: string,
): StickerDef => ({ key, kind: 'ladder', name, weightKg, tier, fact });

const R = (key: string, name: string, requirement: RareRequirement, fact: string): StickerDef => ({
  key,
  kind: 'rare',
  name,
  requirement,
  fact,
});

const D = (key: string, name: string, fact: string): StickerDef => ({ key, kind: 'drop', name, fact });
const M = (key: string, name: string, fact: string): StickerDef => ({ key, kind: 'landmark', name, fact });

/** The whole collection (docs/design/collection.md). Keys are the art file names in art/stickers/. */
export const STICKERS: readonly StickerDef[] = [
  // Weight ladder, ordered by weight.
  L('rabbit', 'Rabbit', 2, 'common', 'Rabbits can see almost all the way around them without turning their heads.'),
  L('cat', 'Cat', 4, 'common', "A cat's flexible spine and balancing tail help it land on all fours after a fall."),
  L('red-panda', 'Red panda', 5, 'exotic', 'Red pandas grip bamboo with a false thumb, which is really a modified wrist bone.'),
  L('koala', 'Koala', 9, 'exotic', 'Koalas may sleep 18 to 22 hours a day because eucalyptus leaves give them so little energy.'),
  L('corgi', 'Corgi', 12, 'common', 'Corgis were bred in Wales to herd cattle by nipping at their heels.'),
  L('emperor-penguin', 'Emperor penguin', 30, 'exotic', 'Emperor penguins dive deeper than any other bird, down to about 1,850 feet.'),
  L('golden-retriever', 'Golden retriever', 32, 'common', 'Golden retrievers were bred in 19th-century Scotland to fetch shot waterfowl.'),
  L('snow-leopard', 'Snow leopard', 45, 'exotic', 'Snow leopards can leap as far as 50 feet across mountain slopes.'),
  L('capybara', 'Capybara', 55, 'exotic', "Capybaras are the world's biggest rodent, and strong swimmers with partly webbed toes."),
  L('goat', 'Goat', 65, 'common', 'Goats are nimble climbers that can scale steep, rocky slopes.'),
  L('sheep', 'Sheep', 80, 'common', 'Sheep were among the first animals people domesticated, about 10,000 years ago.'),
  L('kangaroo', 'Kangaroo', 85, 'exotic', 'Kangaroos hop on powerful hind legs and use their tail as a fifth leg when moving slowly.'),
  L('giant-panda', 'Giant panda', 110, 'exotic', 'A giant panda eats 70 to 100 pounds of bamboo every day to get enough nutrients.'),
  L('pig', 'Pig', 150, 'common', "Pigs can't sweat much, so they roll in mud to cool down, not because they're dirty."),
  L('gorilla', 'Gorilla', 170, 'exotic', 'Gorillas are plant eaters, and leaves, stems and fruit fuel males that can reach 500 pounds.'),
  L('lion', 'Lion', 190, 'exotic', "A lion's roar can be heard from five miles away."),
  L('polar-bear', 'Polar bear', 450, 'exotic', 'Polar bears look white, but their skin is black, which helps absorb the sun\'s warmth.'),
  L('horse', 'Horse', 500, 'common', 'Horses can doze standing up thanks to a leg-locking system called the stay apparatus.'),
  L('moose', 'Moose', 550, 'exotic', 'Moose are strong swimmers that can paddle several miles and even dive fully underwater.'),
  L('cow', 'Cow', 700, 'common', "A cow's stomach has four compartments, and cows spend up to 8 hours a day chewing cud."),
  L('bison', 'Bison', 900, 'exotic', 'American bison can weigh over a ton, yet can run up to 40 miles per hour.'),
  L('walrus', 'Walrus', 1000, 'exotic', 'Walruses use their tusks to haul their enormous bodies out of freezing water.'),
  L('giraffe', 'Giraffe', 1200, 'exotic', 'Giraffes can sprint as fast as 35 miles per hour over short distances.'),
  L('hippo', 'Hippo', 1500, 'exotic', 'Hippos weigh up to 4.5 tons but can still run 22 miles per hour over short distances.'),
  L('rhino', 'Rhino', 2300, 'exotic', "A rhino's horn is made of keratin, the same protein as your fingernails."),
  L('elephant', 'Elephant', 4000, 'common', "An elephant's trunk has about 90,000 tiny muscle bundles, strong yet precise enough to grab small items."),
  L('orca', 'Orca', 6000, 'exotic', 'Orcas are the largest members of the dolphin family.'),
  L('whale-shark', 'Whale shark', 19000, 'exotic', 'Whale sharks are the biggest fish in the sea, yet they mainly eat tiny plankton.'),
  L('humpback-whale', 'Humpback whale', 30000, 'exotic', 'Humpback whales sing songs that carry far across the ocean and can last for hours.'),
  L('blue-whale', 'Blue whale', 150000, 'exotic', 'Blue whales are the largest animals known to have ever lived, up to 105 feet long.'),

  // Rare finds.
  R('axolotl', 'Axolotl', { kind: 'workouts', value: 10 }, 'Axolotls can regrow lost limbs, a skill scientists study closely.'),
  R('quokka', 'Quokka', { kind: 'streak', value: 4 }, 'Quokkas are small kangaroo relatives, and the best-known colony lives on fox-free Rottnest Island.'),
  R('fennec-fox', 'Fennec fox', { kind: 'prs', value: 5 }, 'The fennec is the world\'s smallest fox, with ears about 6 inches long.'),
  R('pangolin', 'Pangolin', { kind: 'workouts', value: 25 }, 'Pangolins are covered in scales made of keratin, and they roll into a ball when threatened.'),
  R('okapi', 'Okapi', { kind: 'streak', value: 12 }, "The giraffe is the okapi's only living relative."),
  R('snowy-owl', 'Snowy owl', { kind: 'prs', value: 25 }, 'A snowy owl can eat over 1,600 lemmings in a year.'),
  R('pink-fairy-armadillo', 'Pink fairy armadillo', { kind: 'volume', value: 100_000 }, 'The pink fairy armadillo is the smallest armadillo and lives in burrows in sandy ground.'),
  R('white-tiger', 'White tiger', { kind: 'workouts', value: 50 }, "White tigers aren't albino: a single gene change gives them pale coats, and they keep dark stripes."),
  R('golden-snub-nosed-monkey', 'Golden snub-nosed monkey', { kind: 'streak', value: 26 }, 'Golden snub-nosed monkeys live in cold mountain forests and move to lower slopes in winter.'),
  R('narwhal', 'Narwhal', { kind: 'volume', value: 1_000_000 }, "A narwhal's long spiral tusk is actually an overgrown tooth, up to 10 feet long."),

  // Ultra-rare drops.
  D('pink-river-dolphin', 'Pink river dolphin', 'Pink river dolphins can bend their necks up to 90 degrees to swim between flooded trees.'),
  D('kakapo', 'Kākāpō', "The kākāpō is the world's heaviest parrot, and it can't fly."),
  D('white-peacock', 'White peacock', 'White peacocks are a rare white colour form of the Indian peafowl, one of several genetic colour mutations.'),

  // Landmarks, in journey order.
  M('chichen-itza', 'Chichén Itzá', 'El Castillo has 91 steps on each of its 4 sides. Add the top platform and you get 365, one for every day of the year.'),
  M('christ-the-redeemer', 'Christ the Redeemer', "Christ the Redeemer's arms stretch 28 metres wide, and its concrete body is covered in thousands of small soapstone tiles."),
  M('petra', 'Petra', "Petra's Treasury was carved straight out of a cliff of rosy sandstone, and its front is about 39.5 metres tall."),
  M('colosseum', 'Colosseum', 'The Colosseum, opened in AD 80, is about 48.5 metres tall and was built to seat tens of thousands of fans.'),
  M('taj-mahal', 'Taj Mahal', "The Taj Mahal's white marble looks pink at dawn, bright white at midday and glowing by moonlight."),
  M('statue-of-liberty', 'Statue of Liberty', 'From ground to torch tip, the Statue of Liberty stands about 305 feet (93 m) tall.'),
  M('big-ben', 'Big Ben', '"Big Ben" is really the nickname of the Great Bell, and the tower is called Elizabeth Tower.'),
  M('great-pyramid', 'Great Pyramid', 'The Great Pyramid was the tallest human-made structure on Earth for about 3,800 years, until a cathedral spire beat it in 1311.'),
  M('eiffel-tower', 'Eiffel Tower', 'The Eiffel Tower grows a few millimetres taller in summer as its iron expands in the heat.'),
  M('empire-state', 'Empire State Building', 'The Empire State Building has 1,860 stairs from the street to the 102nd floor.'),
  M('burj-khalifa', 'Burj Khalifa', 'The Burj Khalifa is the world\'s tallest building, at 828 metres.'),
  M('machu-picchu', 'Machu Picchu', 'Machu Picchu sits about 2,430 metres above sea level, on a saddle between two Andean peaks.'),
  M('golden-gate', 'Golden Gate Bridge', "The Golden Gate Bridge's International Orange was picked to suit its setting and help passing ships see it."),
  M('mount-fuji', 'Mount Fuji', "Mount Fuji is Japan's highest mountain at 3,776 metres, and a UNESCO World Heritage site."),
  M('mount-everest', 'Mount Everest', "In 2020, Nepal and China jointly announced Everest's official height as 8,848.86 metres."),
  M('marathon', 'Marathon', 'The marathon distance of 42.195 km traces back to the 1908 London Olympics course.'),
  M('great-wall', 'Great Wall of China', 'The Great Wall is many walls built over centuries, adding up to about 21,196 km counting every branch.'),
];

/** The streak week at which each landmark is reached (spec: Decisions). */
export const LANDMARK_JOURNEY: ReadonlyArray<{ week: number; key: string }> = [
  { week: 1, key: 'chichen-itza' },
  { week: 2, key: 'christ-the-redeemer' },
  { week: 3, key: 'petra' },
  { week: 4, key: 'colosseum' },
  { week: 6, key: 'taj-mahal' },
  { week: 8, key: 'statue-of-liberty' },
  { week: 10, key: 'big-ben' },
  { week: 12, key: 'great-pyramid' },
  { week: 16, key: 'eiffel-tower' },
  { week: 20, key: 'empire-state' },
  { week: 24, key: 'burj-khalifa' },
  { week: 28, key: 'machu-picchu' },
  { week: 32, key: 'golden-gate' },
  { week: 36, key: 'mount-fuji' },
  { week: 40, key: 'mount-everest' },
  { week: 46, key: 'marathon' },
  { week: 52, key: 'great-wall' },
];
