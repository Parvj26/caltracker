# Sticker Prompt Pack (AI-generated art)

How to generate CalTracker's animal and landmark stickers with an AI image tool so all 52 images look like one set. The animal list is in `collection.md`.

## Which tool
- **Adobe Firefly** (recommended): Adobe says it's trained on licensed and public-domain content and marks outputs as commercially safe. It has a "Style reference" upload, which keeps the set consistent.
- **ChatGPT image generation:** also fine for commercial use under OpenAI's terms. You can keep everything in one chat and say "same style as before".
- Use one tool for the whole set. Mixing tools breaks consistency.

**Note:** purely AI-generated images generally can't be copyrighted in the US, so others could copy them. The CalTracker name and brand stay protectable.

## Step-by-step
1. **Make 3 anchor stickers first:** Capybara (exotic), Corgi (common) and Okapi (rare). Generate 4–8 options each and pick the cutest.
2. **Lock the style.** Upload your favourite anchor as the **style reference** (Firefly) or say "match this exact style" (ChatGPT) for every remaining animal.
3. **Generate the rest** using the master prompt plus each animal's subject line below. Make 2–4 options per animal and pick one.
4. **Save** each pick as a PNG, at least 1024×1024, named `animal-name.png` (e.g. `red-panda.png`), into one folder.
5. **Hand the folder to Claude.** The processing script removes backgrounds, adds the white die-cut border and shadow, and exports app-ready sizes. You don't need to do any editing.

## Master prompt (use for every animal)
> A single cute chibi **[SUBJECT]** sticker illustration. Big head, small body, large glossy dark eyes with a white highlight, tiny smile, soft rosy cheeks. Rounded, chunky, simple shapes. Flat colours with very soft shading, thick dark outline (#121212) around the whole character. Playful and lovable, like a premium collectible sticker. Centered, full body, facing slightly toward the viewer, plain pure white background, no text, no border, no shadow, no props unless described.

**Palette hint (optional, add if colours drift):** "use soft pastel accents of lime green #C8F169, pink #FFC9E3 and sky blue #B9E3FF where natural".

**Avoid (Firefly "exclude" / add to the ChatGPT prompt):** realistic, photo, 3D render, text, watermark, multiple animals, busy background, scary, sharp teeth.

## Subject lines

### Common
| File | [SUBJECT] |
|---|---|
| rabbit.png | fluffy grey bunny rabbit with floppy ears |
| cat.png | orange tabby cat sitting with a curled tail |
| corgi.png | Pembroke Welsh corgi with big ears and a fluffy bum |
| golden-retriever.png | happy golden retriever puppy with a wagging tail |
| goat.png | white baby goat with tiny horns |
| sheep.png | fluffy white sheep with a round woolly body |
| pig.png | round pink piglet with a curly tail |
| horse.png | chestnut horse with a flowing mane |
| cow.png | black-and-white dairy cow with a pink nose |
| elephant.png | grey baby elephant with big round ears, trunk raised |

### Exotic
| File | [SUBJECT] |
|---|---|
| red-panda.png | red panda with a striped bushy tail |
| koala.png | grey koala hugging a eucalyptus branch |
| emperor-penguin.png | emperor penguin with a yellow neck patch |
| snow-leopard.png | snow leopard cub with spotted fur and a long fluffy tail |
| capybara.png | relaxed capybara with a small orange on its head |
| kangaroo.png | kangaroo with a joey peeking out of its pouch |
| giant-panda.png | giant panda chewing bamboo |
| gorilla.png | friendly silverback gorilla, sitting |
| lion.png | lion with a big round fluffy mane |
| polar-bear.png | white polar bear cub |
| moose.png | moose with big round antlers |
| bison.png | shaggy brown American bison |
| walrus.png | chubby walrus with small tusks and whiskers |
| giraffe.png | giraffe with a long neck and ossicones |
| hippo.png | round purple-grey hippo, mouth slightly open in a smile |
| rhino.png | grey rhino with one rounded horn |
| orca.png | orca whale jumping, black and white |
| whale-shark.png | whale shark with white spots |
| humpback-whale.png | humpback whale with long pectoral fins |
| blue-whale.png | huge friendly blue whale, spout of water |

### Rare finds
| File | [SUBJECT] |
|---|---|
| axolotl.png | pink axolotl with frilly gills |
| quokka.png | smiling quokka |
| fennec-fox.png | fennec fox with enormous ears |
| pangolin.png | pangolin curled slightly, with scales |
| okapi.png | okapi with striped legs |
| snowy-owl.png | white snowy owl with golden eyes |
| pink-fairy-armadillo.png | tiny pink fairy armadillo |
| white-tiger.png | white tiger cub with dark stripes and blue eyes |
| golden-snub-nosed-monkey.png | golden snub-nosed monkey with golden fur and a blue face |
| narwhal.png | narwhal with a spiral tusk |

### Ultra-rare
| File | [SUBJECT] |
|---|---|
| pink-river-dolphin.png | pink Amazon river dolphin |
| kakapo.png | green kākāpō parrot, round and fluffy |
| white-peacock.png | white peacock with its tail fanned out |

### Landmarks (distance badges)
For landmarks, swap the master prompt's first line to: "A single cute, simplified **[SUBJECT]** sticker illustration, rounded chunky shapes…". Keep the rest the same.

| File | [SUBJECT] |
|---|---|
| statue-of-liberty.png | Statue of Liberty |
| big-ben.png | Big Ben clock tower |
| eiffel-tower.png | Eiffel Tower in daylight |
| empire-state.png | Empire State Building |
| burj-khalifa.png | Burj Khalifa skyscraper |
| golden-gate.png | Golden Gate Bridge |
| mount-fuji.png | Mount Fuji with a snowy peak |
| mount-everest.png | Mount Everest peak with a little flag |
| marathon.png | a finish-line banner with a running shoe |

## Quality checklist (before handing over)
- One animal per image, whole body visible, nothing cut off.
- Same outline thickness and eye style as the anchors.
- No text, logos or watermarks.
- Looks cute at thumbnail size: squint test at ~60 px.
