# Which game-icons.net picture each item and spell gets. Ordered: the first pattern that matches the name wins,
# then the fallbacks by kind / school. Icon names are file names in https://github.com/game-icons/icons
import re

ITEM_RULES = [
    # weapons
    (r'^battleaxe|berserker axe', 'battle-axe'), (r'^greataxe', 'war-axe'), (r'^handaxe', 'hatchet'), (r'dwarven thrower', 'thor-hammer'),
    (r'^blowgun needle', 'dart'), (r'^blowgun', 'dart'), (r'^greatclub', 'spiked-bat'), (r'^club', 'wood-club'),
    (r'crossbow bolt', 'crossbow'), (r'crossbow, hand', 'crossbow'), (r'crossbow', 'crossbow'),
    (r'dagger of venom', 'dripping-knife'), (r'^dagger', 'plain-dagger'), (r'^small knife', 'bowie-knife'), (r'^dart', 'dart'), (r'^flail', 'flail'),
    (r'^glaive', 'glaive'), (r'^greatsword', 'broadsword'), (r'^halberd', 'halberd'), (r'javelin of lightning', 'lightning-bow'), (r'^javelin', 'thrown-spear'),
    (r'^lance', 'spear-feather'), (r'^light hammer', 'claw-hammer'), (r'hammer of thunderbolts', 'thor-hammer'), (r'^warhammer', 'warhammer'), (r'^maul', 'flat-hammer'),
    (r'^hammer, sledge', 'flat-hammer'), (r'^hammer$', 'claw-hammer'),
    (r'oathbow', 'bow-arrow'), (r'longbow|shortbow', 'pocket-bow'), (r'^longsword', 'broadsword'), (r'^shortsword', 'gladius'),
    (r'mace of disruption', 'flanged-mace'), (r'mace of terror', 'bone-mace'), (r'mace', 'spiked-mace'), (r'^morningstar', 'flail'),
    (r'^net$', 'fishing-net'), (r'^pike$', 'spear-hook'), (r'quarterstaff|wooden staff', 'bo'), (r'^rapier', 'pointy-sword'),
    (r'scimitar', 'katana'), (r'^sickle', 'sickle'), (r'^sling bullet', 'stone-pile'), (r'^sling', 'sling'), (r'^spear', 'spear-hook'),
    (r'trident', 'trident'), (r'war pick|pick, miner', 'war-pick'), (r'^whip', 'whip'),
    (r'flame tongue', 'flame-spin'), (r'frost brand', 'ice-spear'), (r'holy avenger', 'shining-sword'), (r'sun blade', 'sun-spear'),
    (r'vorpal', 'decapitation'), (r'nine lives stealer|life stealing', 'bloody-sword'), (r'dancing sword', 'spinning-sword'),
    (r'sword of sharpness', 'piercing-sword'), (r'sword of wounding', 'dripping-sword'), (r'luck blade', 'clover'), (r'dragon slayer', 'dragon-head'),
    (r'giant slayer', 'giant'), (r'defender', 'sword-brandish'), (r'vicious weapon', 'sword-clash'), (r'^weapon, \+', 'rune-sword'),
    (r'arrow of slaying', 'chained-arrow-heads'), (r'^ammunition', 'arrow-cluster'), (r'^arrow$', 'arrow-cluster'), (r'quiver', 'quiver'),
    # armour and shields
    (r'shield of missile', 'arrows-shield'), (r'arrow-catching shield', 'arrows-shield'), (r'animated shield', 'bell-shield'),
    (r'spellguard shield', 'magic-shield'), (r'shield', 'round-shield'),
    (r'dragon scale mail', 'dragon-shield'), (r'breastplate', 'breastplate'), (r'chain shirt', 'mail-shirt'), (r'elven chain', 'mail-shirt'),
    (r'chain mail', 'chain-mail'), (r'scale mail', 'scale-mail'), (r'ring mail', 'chain-mail'), (r'half plate|plate armor|dwarven plate|splint', 'chest-armor'),
    (r'hide', 'fur-shirt'), (r'studded leather|glamoured', 'leather-vest'), (r'leather', 'leather-armor'), (r'padded', 'armor-vest'),
    (r'demon armor', 'spiked-armor'), (r'adamantine|mithral|armor of|^armor, \+', 'layered-armor'),
    # potions, oils, vials
    (r'healing|supreme|superior', 'health-potion'), (r'potion of poison|poison, basic|poisoner', 'poison-bottle'), (r'philter of love', 'heart-bottle'),
    (r'potion of (fire|cold|acid|lightning|thunder|force|necrotic|psychic|radiant|poison) resistance', 'standing-potion'),
    (r'giant strength', 'round-potion'), (r'potion of (flying|gaseous)', 'bottle-vapors'), (r'potion', 'magic-potion'),
    (r'^oil of|^oil \(', 'oil-drum'), (r'alchemist.s fire', 'fire-bottle'), (r'acid \(vial\)', 'acid'), (r'antitoxin', 'vial'),
    (r'holy water', 'water-flask'), (r'perfume', 'perfume-bottle'), (r'^vial', 'vial'), (r'universal solvent|sovereign glue', 'round-bottom-flask'),
    (r'efreeti bottle|eversmoking', 'bottle-vapors'), (r'decanter', 'water-bottle'), (r'iron flask', 'flask'), (r'bottle, glass', 'square-bottle'),
    (r'flask or tankard', 'beer-stein'), (r'restorative ointment', 'mortar'), (r'ink \(', 'ink-swirl'), (r'^ink pen', 'quill-ink'),
    # jewellery
    (r'ring of three wishes', 'diamond-ring'), (r'ring of invisibility', 'ring'), (r'ring of the ram', 'ram'), (r'ring of shooting stars', 'falling-star'),
    (r'ring of warmth', 'fire-ring'), (r'ring of x-ray', 'eye-target'), (r'ring of (fire|.* elemental)', 'fire-ring'), (r'signet ring', 'skull-signet'),
    (r'^ring|ring of', 'gem-pendant' if False else 'ring'),
    (r'necklace of fireballs', 'fire-ray'), (r'prayer beads', 'pouch-with-beads'), (r'necklace|amulet|periapt|medallion|talisman|brooch|scarab', 'gem-pendant'),
    (r'ioun stone', 'floating-crystal'), (r'elemental gem|gem of', 'gems'), (r'luckstone|stone of good luck', 'clover'), (r'pearl of power', 'pearl-necklace'),
    (r'circlet|headband|helm of brilliance', 'jewel-crown'), (r'helm', 'black-knight-helm'), (r'hat of disguise', 'pointy-hat'),
    # clothing
    (r'boots|slippers|winged boots', 'leather-boot'), (r'gloves|gauntlets', 'gauntlet'), (r'bracers', 'bracers'), (r'belt of', 'belt-buckles'),
    (r'cloak of the bat', 'bat-wing'), (r'cloak of the manta ray', 'manta-ray'), (r'cloak of arachnida', 'spider-alt'), (r'cloak|cape|mantle', 'cloak'),
    (r'robe of stars', 'night-sky'), (r'robe of eyes', 'eye-shield'), (r'robe|vestments', 'robe'), (r'wings of flying', 'feathered-wing'),
    (r'clothes, costume', 'jester-hat'), (r'clothes', 'shirt'), (r'eyes of|goggles', 'steampunk-goggles'),
    # wands, staffs, rods, books, scrolls
    (r'wand of fireballs', 'fire-wave'), (r'wand of lightning', 'lightning-arc'), (r'wand of web', 'spider-web'), (r'wand of polymorph', 'frog'),
    (r'wand of magic missiles', 'missile-swarm'), (r'wand|yew wand', 'fairy-wand'), (r'staff of fire', 'fire-bowl'), (r'staff of frost', 'frozen-orb'),
    (r'staff of healing', 'healing'), (r'staff of the python', 'snake'), (r'staff of the woodlands', 'tree-branch'), (r'staff of swarming', 'bee'),
    (r'staff of thunder', 'lightning-tree'), (r'staff of withering', 'skull-staff'), (r'staff of (power|the magi)', 'wizard-staff'), (r'staff', 'wizard-staff'),
    (r'immovable rod', 'crowbar'), (r'rod of lordly might', 'thor-hammer'), (r'rod of rulership', 'winged-scepter'), (r'rod', 'winged-scepter'),
    (r'spellbook', 'spell-book'), (r'manual of .*golem', 'golem-head'), (r'manual|tome', 'book-cover'), (r'^book', 'book-cover'),
    (r'spell scroll', 'scroll-unfurled'), (r'case, map or scroll', 'scroll-quill'), (r'paper|parchment', 'scroll-unfurled'),
    # wondrous things
    (r'bag of holding|handy haversack', 'swap-bag'), (r'bag of tricks', 'swap-bag'), (r'bag of beans', 'beanstalk'), (r'bag of devouring', 'mimic-chest'),
    (r'portable hole', 'portal'), (r'carpet of flying', 'red-carpet'), (r'broom of flying', 'magic-broom'), (r'feather token', 'feather'),
    (r'figurine of wondrous power', 'stone-bust'), (r'crystal ball', 'crystal-ball'), (r'orb of dragonkind', 'dragon-orb'), (r'sphere of annihilation', 'black-hole-bolas'),
    (r'cube of force|cubic gate', 'cube'), (r'deck of', 'card-random'), (r'horn of valhalla|horn of blasting', 'hunting-horn'), (r'pipes of', 'pan-flute'),
    (r'chime of opening', 'ringing-bell'), (r'mirror', 'mirror-mirror'), (r'lantern of revealing|lantern', 'lantern'), (r'candle', 'candle-light'),
    (r'well of many worlds', 'portal'), (r'instant fortress', 'castle'), (r'folding boat', 'paper-boat'), (r'apparatus of the crab', 'crab'),
    (r'dimensional shackles|manacles', 'manacles'), (r'iron bands', 'chain-mail'), (r'rope', 'rope-coil'), (r'dust of', 'powder-bag'),
    (r'wind fan', 'feather'), (r'bowl of commanding', 'water-splash'), (r'brazier', 'fire-bowl'), (r'censer', 'incense'), (r'stone of controlling', 'stone-block'),
    (r'horseshoes', 'horseshoe'), (r'bead of force', 'glass-ball'), (r'gem of brightness', 'crystal-shine'), (r'marvelous pigments', 'paint-brush'),
    (r'gray bag|rust bag|tan bag', 'swap-bag'),
    # adventuring gear
    (r'abacus', 'abacus'), (r'alms box', 'locked-chest'), (r'backpack|pack$', 'backpack'), (r'ball bearings', 'pearl-necklace'), (r'barrel', 'barrel'),
    (r'basket', 'basket'), (r'bedroll', 'sleeping-bag'), (r'^bell', 'ringing-bell'), (r'blanket', 'cloak'), (r'block and tackle', 'pulley-hook'),
    (r'incense', 'incense'), (r'bucket', 'empty-wood-bucket'), (r'caltrops', 'caltrops'), (r'case, crossbow', 'quiver'), (r'chain \(', 'crossed-chains'),
    (r'chalk', 'chalk-outline-murder'), (r'chest', 'chest'), (r'climber', 'mountain-climbing'), (r'component pouch|pouch', 'knapsack'),
    (r'crowbar', 'crowbar'), (r'crystal', 'crystal-cluster'), (r'disguise kit', 'domino-mask'), (r'emblem|reliquary', 'holy-symbol'),
    (r'fishing tackle', 'fishing-hook'), (r'forgery kit', 'quill-ink'), (r'grappling hook', 'grapple'), (r'healer', 'first-aid-kit'),
    (r'herbalism', 'herbs-bundle'), (r'hourglass', 'hourglass'), (r'hunting trap', 'wolf-trap'), (r'jug or pitcher', 'jug'), (r'ladder', 'ladder'),
    (r'lamp', 'magic-lamp'), (r'little bag of sand', 'powder-bag'), (r'^lock', 'padlock'), (r'magnifying glass', 'magnifying-glass'),
    (r'mess kit', 'cooking-pot'), (r'^orb$', 'crystal-ball'), (r'piton|spike, iron', 'tent-peg' if False else 'spikes'), (r'pole', 'bo'), (r'pot, iron', 'cooking-pot'),
    (r'ram, portable', 'siege-ram'), (r'rations', 'meat'), (r'sack', 'knapsack'), (r'scale, merchant', 'scales'), (r'sealing wax', 'wax-seal'),
    (r'shovel', 'trench-spade'), (r'whistle', 'whistle'), (r'soap', 'soap'), (r'mistletoe', 'oak-leaf'), (r'spyglass', 'spyglass'), (r'string', 'yarn'),
    (r'tent', 'camping-tent'), (r'tinderbox', 'campfire'), (r'torch', 'torch'), (r'totem', 'totem-head'), (r'waterskin', 'water-flask'), (r'whetstone', 'stone-block'),
    # tools and instruments
    (r'alchemist', 'round-bottom-flask'), (r'bagpipes', 'bagpipes'), (r'brewer', 'beer-stein'), (r'calligrapher', 'quill-ink'), (r'carpenter', 'hand-saw'),
    (r'cartographer', 'treasure-map'), (r'cobbler', 'boots'), (r'cook', 'cooking-pot'), (r'dice set', 'rolling-dices'), (r'drum', 'drum'),
    (r'dulcimer', 'harp'), (r'^flute', 'flute'), (r'glassblower', 'glass-heart' if False else 'erlenmeyer'), (r'^horn$', 'hunting-horn'), (r'jeweler', 'gem-pendant'),
    (r'leatherworker', 'leather-armor'), (r'lute|viol', 'lyre'), (r'lyre', 'lyre'), (r'mason', 'brick-wall'), (r'navigator', 'compass'),
    (r'painter', 'paint-brush'), (r'pan flute', 'pan-flute'), (r'playing card', 'card-random'), (r'potter', 'amphora'), (r'shawm', 'flute'),
    (r'smith', 'anvil-impact'), (r'thieves', 'lockpicks'), (r'tinker', 'gears'), (r'weaver', 'yarn'), (r'woodcarver', 'wood-axe'),
    # mounts and vehicles
    (r'animal feed', 'wheat'), (r'barding', 'horse-head'), (r'bit and bridle', 'horse-head'), (r'camel', 'camel'), (r'carriage|wagon', 'old-wagon'),
    (r'^cart$', 'old-wagon'), (r'chariot', 'chariot'), (r'donkey|mule', 'donkey'), (r'elephant', 'elephant'), (r'galley|warship|longship', 'galley'),
    (r'horse|pony|warhorse', 'horse-head'), (r'keelboat|sailing ship', 'shooner-sailboat'), (r'rowboat', 'small-fishing-sailboat'), (r'mastiff', 'sitting-dog'),
    (r'saddlebags', 'saddle'), (r'saddle', 'saddle'), (r'sled', 'old-wagon'), (r'stabling', 'barn'),
]
ITEM_FALLBACK = {'weapon': 'sword-brandish', 'armor': 'chest-armor', 'gear': 'knapsack', 'tool': 'toolbox', 'mount': 'horse-head', 'magic': 'sparkles'}

# spells: name keywords first, then the damage type, then the school
SPELL_RULES = [
    (r'fireball|delayed blast', 'fireball'), (r'fire bolt|scorching ray|flame blade', 'fire-ray'), (r'wall of fire|fire storm|incendiary', 'fire-wave'),
    (r'burning hands|flame strike|flaming sphere|fire shield|produce flame|heat metal|meteor|immolation|firebolt|create bonfire|flame', 'flame'),
    (r'lightning|call lightning|witch bolt|chain lightning|shocking grasp', 'lightning-arc'), (r'thunder|shatter|thunderwave|thunderclap|destructive wave', 'sonic-shout'),
    (r'cone of cold|ice storm|ice knife|frost|freezing|ray of frost|snilloc|wall of ice|sleet storm|chill touch', 'ice-bolt'),
    (r'acid', 'acid'), (r'poison|stinking cloud|cloudkill|contagion', 'poison-cloud'),
    (r'magic missile', 'missile-swarm'), (r'eldritch blast', 'beam-wake'), (r'disintegrate', 'disintegrate'), (r'power word', 'mighty-force'),
    (r'cure wounds|healing word|heal|regenerate|mass cure|prayer of healing|aura of vitality', 'healing'), (r'revivify|raise dead|resurrection|reincarnate|true resurrection', 'angel-wings'),
    (r'spare the dying|death ward|gentle repose', 'heart-plus'), (r'bless|aid|beacon of hope|holy aura|spirit guardians|sacred flame|guiding bolt|divine', 'holy-symbol'),
    (r'shield of faith|shield|mage armor|armor of agathys|protection from|sanctuary|globe of invulnerability|warding|resistance', 'magic-shield'),
    (r'invisibility|invisible', 'invisible'), (r'teleport|misty step|dimension door|thunder step|far step|word of recall|plane shift|gate|teleportation circle', 'teleport'),
    (r'fly$|fly\b|levitate|feather fall|jump|longstrider|haste|expeditious', 'feathered-wing'), (r'slow$|time stop|hold|paralyz', 'stopwatch'),
    (r'charm|suggestion|dominate|command|friends|enthrall|geas|modify memory|compulsion', 'charm'), (r'sleep', 'night-sleep'),
    (r'fear|cause fear|phantasmal|weird|nightmare|dream', 'screaming'), (r'confusion|feeblemind|mind|telepathy|detect thoughts|synaptic|psychic', 'brain'),
    (r'illusion|image|disguise|mirage|silent image|minor illusion|hallucinatory|seeming|mislead|nystul', 'mirror-image' if False else 'domino-mask'),
    (r'detect|identify|locate|find the path|scrying|clairvoyance|true seeing|see invisibility|arcane eye|legend lore|divination|augury|commune|contact other plane|foresight|guidance|comprehend', 'all-seeing-eye'),
    (r'animate dead|create undead|finger of death|circle of death|vampiric|blight|harm|inflict wounds|toll the dead|speak with dead|danse', 'skull-crossed-bones'),
    (r'summon|conjure|find familiar|find steed|planar binding|animal|beast|polymorph|shapechange|wild shape', 'paw'),
    (r'entangle|plant|vine|thorn|wall of thorns|barkskin|goodberry|tree|grasping vine|druidcraft|spike growth|plant growth|transport via plants', 'vine-flower'),
    (r'web', 'spider-web'), (r'fog|cloud|darkness|gust|wind|whirlwind|control weather|storm', 'tornado'),
    (r'water|create or destroy water|tidal|tsunami|control water', 'water-splash'), (r'earth|stone|earthquake|move earth|wall of stone|erupting earth|mold earth', 'stone-block'),
    (r'light$|light\b|daylight|dancing lights|faerie fire|continual flame|sunbeam|sunburst|moonbeam', 'sun'), (r'banish|dispel|counterspell|antimagic|remove curse', 'magic-swirl'),
    (r'wish|miracle', 'star-swirl'), (r'mending|fabricate|creation|minor creation', 'anvil-impact'), (r'alarm|glyph|symbol|arcane lock|knock', 'rune-stone'),
    (r'message|sending|tongues|speak with', 'chat-bubble'), (r'bane|curse|hex|bestow|eyebite|blindness', 'cursed-star'), (r'enlarge|reduce|giant', 'magnifying-glass'),
    (r'weapon|smite|magic weapon|shillelagh|spiritual weapon|elemental weapon|blade|true strike|booming', 'sword-brandish'), (r'wall of force|forcecage|resilient sphere|force', 'cube'),
    (r'prestidigitation|thaumaturgy|minor|mage hand|unseen servant|floating disk|rope trick|magnificent mansion|tiny hut|secret chest', 'magic-palm'),
]
SPELL_DAMAGE = {'fire': 'flame', 'cold': 'ice-bolt', 'lightning': 'lightning-arc', 'thunder': 'sonic-shout', 'acid': 'acid', 'poison': 'poison-cloud',
    'necrotic': 'skull-crossed-bones', 'radiant': 'sun', 'psychic': 'brain', 'force': 'mighty-force'}
SPELL_SCHOOL = {'abjuration': 'magic-shield', 'conjuration': 'magic-portal', 'divination': 'all-seeing-eye', 'enchantment': 'charm',
    'evocation': 'magic-swirl', 'illusion': 'domino-mask', 'necromancy': 'skull-crossed-bones', 'transmutation': 'cycle'}

# the icons the card editor offers for your own cards (and the side bar's tab icons), on top of the ones above
EXTRA = ['revolver', 'blunderbuss', 'crossed-pistols', 'bayonet', 'bullets', 'heavy-bullets', 'cowboy-holster', 'flint-spark', 'reload-gun-barrel',
    'sawed-off-shotgun', 'gun-stock', 'saber-and-pistol', 'cannon-shot', 'powder', 'hunting-horn', 'barrel', 'sword-brandish', 'sparkles', 'toolbox', 'knapsack', 'chest-armor', 'horse-head', 'coins', 'gold-bar', 'key', 'skeleton-key', 'locked-chest',
    'open-treasure-chest', 'skull', 'crown', 'scroll-unfurled', 'tied-scroll', 'letter-bomb', 'envelope', 'wax-seal', 'treasure-map', 'treasure-map', 'compass',
    'meat', 'shiny-apple', 'bread', 'cheese-wedge', 'wine-bottle', 'beer-stein', 'mushroom-gills', 'herbs-bundle', 'flower-pot', 'bone-gnawer', 'crossed-bones', 'heart-organ',
    'eyeball', 'brain', 'tooth', 'claw', 'fangs', 'tropical-fish', 'feather', 'egg-clutch', 'dragon-head', 'wolf-head', 'spider-alt', 'bat-wing', 'raven', 'owl', 'snake',
    'candle-light', 'lantern', 'torch', 'campfire', 'tombstone', 'coffin', 'gothic-cross', 'ankh', 'pentacle', 'holy-symbol', 'colombian-statue', 'totem-head', 'ceremonial-mask',
    'domino-mask', 'hood', 'top-hat', 'pointy-hat', 'crowned-skull', 'ring', 'gem-pendant', 'gems', 'crystal-cluster', 'magic-potion', 'health-potion',
    'poison-bottle', 'vial', 'flask', 'book-cover', 'spell-book', 'open-book', 'quill-ink', 'hourglass', 'ringing-bell', 'dice-twenty-faces-twenty', 'card-random',
    'trench-spade', 'war-pick', 'hand-saw', 'anvil-impact', 'gears', 'cog', 'chain-mail', 'crossed-chains', 'manacles', 'padlock', 'rope-coil', 'fishing-net', 'caltrops',
    'box-trap', 'wolf-trap', 'barrel', 'wooden-crate', 'bundle-grenade', 'powder', 'pistol-gun', 'musket', 'bandage-roll', 'pill', 'syringe', 'medicines', 'leg',
    'hand', 'eye-target', 'shield', 'round-shield', 'black-knight-helm', 'leather-boot', 'cloak', 'robe', 'gauntlet', 'belt-buckles', 'necklace', 'mirror-mirror',
    # tab icons
    'conversation', 'sword-clash', 'spell-book', 'swap-bag', 'musical-notes', 'treasure-map', 'meeple-group', 'book-cover', 'open-book', 'scroll-unfurled',
    'magic-swirl', 'backpack', 'hourglass', 'crossed-swords', 'lyre',
]

def item_icon(item):
    n = item['name'].lower()
    for pat, icon in ITEM_RULES:
        if re.search(pat, n): return icon
    return ITEM_FALLBACK.get(item.get('kind'), 'sparkles')

def spell_icon(sp):
    n = sp['name'].lower()
    for pat, icon in SPELL_RULES:
        if re.search(pat, n): return icon
    for k, icon in SPELL_DAMAGE.items():
        if k in (sp.get('damage') or '').lower(): return icon
    return SPELL_SCHOOL.get((sp.get('school') or '').lower(), 'magic-swirl')

# ───────── class features, racial traits and feats (tools/build_features.py) ─────────
# the first rule whose pattern is found in the feature's name (lower case) chooses; then the class's own picture
FEATURE_RULES = [
    (r'^rage|mindless rage|relentless rage|persistent rage', 'wolf-howl'), (r'reckless', 'axe-swing'), (r'danger sense', 'eye-target'),
    (r'frenzy|retaliation', 'axe-swing'), (r'unarmored defense', 'armor-vest'), (r'fast movement|unarmored movement|step of the wind', 'running-ninja'),
    (r'brutal critical|improved critical|superior critical', 'broadsword'), (r'extra attack|multiattack', 'crossed-swords'),
    (r'feral instinct|feral senses', 'paw'), (r'intimidating presence|menacing|draconic presence', 'shouting'),
    (r'indomitable', 'muscle-up'), (r'primal champion|perfect self', 'muscle-up'),
    (r'bardic inspiration|superior inspiration|font of inspiration', 'musical-notes'), (r'song of rest', 'lyre'), (r'cutting words', 'sonic-shout'),
    (r'jack of all trades|expertise|reliable talent|peerless skill|remarkable athlete|skill versatility', 'star-swirl'),
    (r'countercharm', 'shield-reflect'), (r'magical secrets|book of ancient secrets|pact of the tome|signature spell|spell mastery', 'book-aura'),
    (r'turn undead|destroy undead|turn the unholy', 'holy-symbol'), (r'channel divinity|divine intervention|divine domain|sacred oath', 'hand-of-god'),
    (r'preserve life|disciple of life|blessed healer|supreme healing|lay on hands|second wind|wholeness of body|natural recovery|cleansing touch', 'healing'),
    (r'divine strike|divine smite|sacred weapon', 'sun'), (r'divine sense', 'third-eye'),
    (r'aura of|aura improvements|holy nimbus', 'aura'), (r'divine health|purity of body|purity of spirit|diamond soul|dwarven resilience|hellish resistance|damage resistance', 'healing-shield'),
    (r'wild shape|beast spells|archdruid', 'bear-head'), (r'druidic|thieves\' cant|tongue of the sun|extra language|beast speech', 'talk'),
    (r'circle of the land|circle spells|nature|land\'s stride', 'oak-leaf'), (r'timeless body', 'sands-of-time'),
    (r'fighting style', 'sword-brandish'), (r'action surge', 'charging-bull'), (r'survivor|relentless endurance', 'heart-plus'),
    (r'martial arts|flurry of blows|empowered strikes|stunning strike|open hand|quivering palm', 'punch-blast'), (r'^ki\b|stillness of mind|tranquility|empty body', 'meditation'),
    (r'patient defense|evasion|uncanny dodge|elusive|deflect missiles|defensive tactics|hunter\'s defense|slippery mind', 'dodge'),
    (r'slow fall', 'feather'), (r'favored enemy|hunter\'s prey|foe slayer|colossus|giant killer|horde breaker', 'target-arrows'),
    (r'natural explorer|primeval awareness', 'footprint'), (r'hide in plain sight|vanish|naturally stealthy|supreme sneak|one with shadows', 'hood'),
    (r'sneak attack', 'stiletto'), (r'cunning action|fast hands|halfling nimbleness', 'sprint'), (r'second-story|otherworldly leap|ascendant step', 'jump-across'),
    (r'use magic device|tinker|artificer', 'gears'), (r'blindsense|keen senses|darkvision|devil\'s sight|eldritch sight|witch sight|eyes of the rune|gaze of two', 'eyeball'),
    (r'stroke of luck|lucky|dark one\'s own luck|thief of five fates', 'clover'), (r'thief\'s reflexes', 'sprint'),
    (r'dragon ancestor|draconic ancestry|draconic resilience|elemental affinity|breath weapon', 'dragon-head'), (r'dragon wings', 'bat-wing'),
    (r'font of magic|flexible casting|sorcerous restoration|arcane recovery|pact magic|mystic arcanum|eldritch master', 'magic-swirl'),
    (r'metamagic', 'star-swirl'), (r'eldritch invocation|pact boon|otherworldly patron', 'warlock-eye'),
    (r'agonizing|eldritch spear|repelling', 'fire-ray'), (r'pact of the blade|thirsting blade|lifedrinker', 'sword-brandish'), (r'pact of the chain|chain master|chains of carceri', 'crossed-chains'),
    (r'dark one\'s blessing|fiendish|hurl through hell|infernal legacy', 'pentacle'),
    (r'evocation savant|sculpt spells|potent cantrip|empowered evocation|overchannel', 'fire-ray'), (r'arcane tradition', 'spell-book'),
    (r'spellcasting|domain spells|oath spells|bonus cantrip|high elf cantrip', 'spell-book'), (r'ability score improvement', 'muscle-up'),
    (r'bonus proficienc|tool proficiency|combat training|weapon training|stonecunning', 'anvil'), (r'fey ancestry|trance', 'fairy-wings'),
    (r'brave', 'checked-shield'), (r'gnome cunning|mire the mind|bewitching|beguiling|mask of many faces|misty visions|sculptor|master of myriad', 'tribal-mask'),
    (r'dwarven toughness|indomitable might', 'muscle-up'), (r'savage attacks', 'axe-swing'), (r'grappler', 'grab'),
    (r'sign of ill omen|dreadful word|minions of chaos|whispers of the grave|visions of distant', 'cursed-star'), (r'armor of shadows|fiendish vigor', 'magic-shield'),
]
CLASS_ICON = {'Barbarian': 'barbarian', 'Bard': 'lyre', 'Cleric': 'holy-symbol', 'Druid': 'oak-leaf', 'Fighter': 'crossed-swords', 'Monk': 'fist',
    'Paladin': 'checked-shield', 'Ranger': 'bow-arrow', 'Rogue': 'cloak-dagger', 'Sorcerer': 'magic-palm', 'Warlock': 'warlock-eye', 'Wizard': 'pointy-hat',
    '': 'star-swirl'}
STANDARD_ICONS = ['running-ninja', 'dodge', 'sprint', 'hood', 'eyeball', 'shaking-hands', 'magnifying-glass', 'exit-door', 'hourglass', 'hand', 'backpack', 'crossed-swords', 'grab', 'shield-bash']

def feature_icon(f):
    n = f['name'].lower()
    if ':' in n:   # a choice (Eldritch Invocation: Agonizing Blast): its own name first
        for pat, icon in FEATURE_RULES:
            if re.search(pat, n.split(':')[-1].strip()): return icon
    for pat, icon in FEATURE_RULES:
        if re.search(pat, n): return icon
    return CLASS_ICON.get(f.get('cls') or '', 'star-swirl')
