# User guide

The site has four parts, in the top bar: **Map**, **Wiki**, **Calendar** and **Table**. Admins (the GM role) also see **Admin**.

The palette button in the top bar (next to full screen) picks the site's accent colour for you, on every page; it's kept in your browser.

## The map
Zoom and drag; click a place for its details, and its wiki page if it has one. The bar on the left has the **Ruler** (R): click point by point for distance and travel time on foot, horseback, cart and ship; double-click to finish. With armies on the map, **March as** picks one and gives its miles a day and days on the road for the ground and pace you choose. **Armies** (Edit mode) adds a company or host as a token with a banner, its name and strength: drag it to move it, tick *Visitors see it* to show it to players (hidden ones aren't sent to them), and change the miles a day by size, ground, forced march and wagons under *March rules*. **Borders** (B) shows nations; hover the button (or right-click it) for a slider that sets how strongly they are coloured.

**Routes** (sea lanes, river passages, roads, trade routes) are drawn on the map for everyone: click one for its length and how long the journey takes at each travel pace. **Water names** label the oceans, seas, bays, lakes and rivers along curves, growing and shrinking with the zoom.

Admins switch **Edit map** on (top right, or E) to place icons from the palette, drag them, edit their details, draw borders and claim land for nations, change icon types, import settlements from a CSV, and set the ruler's scale (Ruler, then *Set the scale from this route*). Every change saves to the server. Two people can edit at once: if someone else saved while you were working, your changes and theirs are put together (one of you moving a town while the other redraws a border are two separate changes), and anyone with the map open who has nothing of their own waiting sees the other's changes come in. Only something you both changed, differently, comes back as a question: keep mine or keep theirs, thing by thing. **History** (by the save light, in Edit map) lists every change in words ("Added Brutayne Keep; moved 3 places; changed the border of Florence"), who made it and when (a person's edits a few minutes apart count as one), with *Details*; *Put back* returns the map to how it was after any of them (and that's a change in the list too, so nothing is lost). Each other version of the map has its own history. To add icons, upload pictures into a Files folder called **Map icons**, then *Rescan icons*.

In the edit bar:
- **Routes**: *Plot a voyage by sea* (click a start and an end, a port or the sea by it, and the course steers round the land), or *Draw a route* point by point (Enter finishes; click a place's icon to start or end exactly on it). Name it, pick its kind and line style, add notes or a wiki page. Drag its points; click **+** between two to add one; Alt-click one to remove it.
- **Names**: pick a kind (ocean, sea, bay, strait, lake, river), *Name some water*, click the water, type the name. Drag its points to bend it along a coast or a river; size, spacing, colour, capitals and the zooms it shows at are in the panel.
- **Map settings** (the cog): the sea's colours, swell, movement, ripples, surf and glints; the rivers' colour and flow; the lettering for names (a few old-style fonts), name and icon sizes, the glow of settlements at night; how dark night gets; where the map opens, how far it zooms out and pans past the edges; miles, kilometres or leagues.

## More on the map
- **Ctrl+K** (or the search box): places, pages, nations and tales, and everything there is to do, by name.
- **Travel** (the rings): *How far in a day* draws a ring for each day's travel from a spot, at any of the ruler's paces. *The way to…* plans a journey between two places (or from a place's card: *Set out from here*, *The way here*). It follows the roads and takes ship from coastal towns when the sea is quicker. You get a day-by-day itinerary: the towns passed, the borders crossed, where each night is spent and the weather as it might be. *Watch the journey* plays it as a tale, with the line drawing itself across the map.
- **Tales** (the book): admins make tours of the map, stop by stop, each with a caption, an hour and a weather. Anyone can watch them; each has a link. **Drift** lets the map wander on its own, for a screen on the wall.
- **Postcards** (the stamp): frame the view and save it as a postcard, with the nation's arms on the stamp and the world's date in the postmark. You can also make an old engraved print, or a plain picture.
- **Coats of arms**: each nation gets arms of its own. Admins change them in the **Heraldry Workshop** (Edit map › Borders, a nation's wiki page, or Ctrl+K): the shield's shape, the field, the ordinary and the charges (well over a hundred, by kind: beasts, birds, monsters, the sea, plants, arms, things and signs, or found by name; bigger or smaller, and facing either way), with the blazon written as you go. They show on the nation's wiki page and folder.
- **A place's own map**: in Edit map, give a place a picture (a city plan, a dungeon) or a version of the world map; its card then has *View map*.
- **The Name Forge** (in the wiki's left column): names in the style of your world's own, learnt from your pages of names, your places and your gods.
- **Who's here**: a coin for each logged-in person with the map or wiki open sits in the top bar (point at one to see whether they're on the map or which page they're reading; click your own to hide). Alt+click the map points something out to everyone.

## Time and weather
Calendar settings › **Eras** sets the letters after a year (AR, BR…), each from the year its era begins, counting up, keeping the calendar's number, or counting down to the next era.

The clock button in the map's left bar shows the world's date and time. The map darkens at night (settlements light up), glows at dawn and dusk, and shows the weather: clouds, fog, rain, storms, snow. Untick *Show night and weather on the map* to hide them.

Admins move the clock on (+10 minutes, +1 hour, a long rest, on to dawn, a day) or set it exactly, and choose the weather and the wind. **Calendar** in the top bar lays out the months, with events on their days (GM-only ones for admins); *Calendar settings* sets the months and their lengths, the weekdays, a cycle of year names, and how long the days are in summer and winter.

## The wiki
The wiki opens on its folders, laid out like a file drive: pages and files together, the main page at the top. Pages are laid out like Wikipedia: contents on the left, infoboxes, references, categories and what links here. Search from the top bar.

Admins have **Edit** and **History** on every page, and *New page* and *Import a document* in the left column. The editor shows a live preview; the toolbar inserts links, pictures, infoboxes, tables, references, quotations, GM-only notes and categories (the page *Help/Formatting* in the example wiki shows them all). Ctrl+S saves. **History** lists every version: view one, compare it with today's, or restore it. *GM only* hides a page from players, and `{{gm}}…{{/gm}}` hides part of one; the server never sends hidden text to players.

**Import a document** takes a Google Docs link (shared as *anyone with the link*), a Word or Markdown file, or pasted text, and opens it in the editor before anything is saved. Pictures in the document come along into Files › Wiki pictures. A bold title line becomes the page title; `**Field** - value` lines under a heading become an infobox; links to Google Docs you've already imported become wiki links.

## Files (the wiki's folders)
Folders holding the wiki's pages and uploaded files together (a page's folder in the wiki is its folder here). Double-click to open; right-click for Rename, Move, Hide from players and Delete. Drag things onto a folder to move them, drop files from your computer to upload, Delete puts things in the **Bin** (restore from there). Pictures, PDFs, documents, sound and video up to 200 MB.

## Admin
The site's name and tagline, the wiki's front page, and **Open to visitors** (anyone can read the map, wiki and files that aren't GM only, without logging in). **People**: make someone an admin, give them a new password, or remove them. **Backups**: everything in one .zip, or the wiki as Markdown files. **Bring in a wiki**: a zipped folder of Markdown files (an Obsidian vault, say) becomes pages.

# The table

## Quick things
- **Hit points**: with tokens selected, type `-7` and Enter to hurt them all, `+4` to heal, `=20` to set; `-12/2` halves it first (a made save).
- **The action bar** (keys 1–9 use its slots): click one of your tokens (GM: any token with a sheet) and a bar comes up along the bottom of the map: its weapons (one click rolls the attack from the sheet), *Spells* (cantrips and prepared spells as cards: click to cast, right-click to read), *Features* (its class features and racial traits for its class, level and race, and what's written on its sheet: click to show one in the chat) and *Actions* (Dash, Disengage, Dodge, Help, Hide and the rest). Hover the bag for its item cards; click it for the inventory.
- **Quick NPC** (Journal, GM): a statted NPC in a few clicks, named by the Name Forge, in the NPCs folder, with a token on the scene.
- **Features** (the Spells tab, *Features* at the top): every class feature, racial trait and feat in the SRD 5.1 as a card, by class, subclass and level, with the actions in combat; click one for the card, click the card to show it in the chat.
- **Ambient sounds** (the ♪ tool, N, GM): click the map to place a looped sound (a fire, a river, a tavern), pick it from the Jukebox or upload one, and set how far it carries, how loud it is, and what walls do to it: heard through, muffled, or stopped (shut doors count; windows just dull it). Players hear them from their tokens, louder nearer; you hear from your selected tokens, or the middle of the screen. They follow everyone's Ambience slider.
- **On a phone**: the site and the table both work on a phone. The pages, your name and logging out are behind ☰; on the table the side bar opens over the bottom half (its button, top right), one finger moves the map, two fingers pinch to zoom, and holding a finger on a token opens its ring of tools.
- **D&D Beyond** (the bottom of the Journal, anyone): paste a character's link (its privacy set to Public on D&D Beyond) and it comes over onto a 5e sheet, with its scores, skills, hit points, weapons, spells, inventory and features. If D&D Beyond won't answer, the dialog gives a link to save the character as a file to pick instead.
- **Full screen**: the button at the right of the top bar. Go full screen from the table: the map, wiki and the rest open inside it and stay full screen (opening a different page of the site leaves full screen, as browsers do).
- **Import** (the bottom of the Journal, GM): from **Roll20** (characters exported with VTT Enhancement Suite, or a whole campaign's campaign.json from R20Exporter: characters with their sheets as they were, handouts, and pages with their maps, walls, doors and tokens; the pictures are fetched from Roll20) or from **Foundry**.
- **Art and scenery** (the picture tool, A, GM): a panel on the left holds your art library, shared by all your campaigns. Upload pictures there, or drop them on the map (with the art tool on they go straight in; otherwise you're asked: a token, or scenery). Drag a picture onto the map, or click it to put it in the middle. Placed art sits under the creatures and can be any size: select it and drag the square corner handle to stretch it (Shift keeps its shape, Alt stops snapping) or the round knob above it to turn it (15° steps; Alt: freely). Double-click it for its settings: width and depth in squares, *Blocks light and sight* (a wagon, a wall of crates, a tree trunk: light and sight stop at its edges, movement doesn't), and *A container*. Set a picture's usual size, folder, blocking and container in the library (✎ on its tile). *Pixels a square* at the bottom says how big pictures come in.
- **Room planner and map generator** (the P tool, GM): draw a scene's map in squares, *painted* (photo textures, shaded stone or timber walls, furniture with shadows) or in *ink* on parchment. *Start a plan here*, then: **Room** drags out a room, **Paint** paints square by square, **Bucket** changes a whole room's floor at once, **Rock** takes floor away (Shift knocks out with any of them). The palette on the left has the floors: flagstones, cobbles, planks, old boards, marble, tiles, carpet, dirt, forest floor, grass, sand, snow, gravel, cave floor, water, lava and chasms. Caves, earth, grass, sand and water get rounded natural edges; built floors keep square corners. **Door** clicks an edge for a door, a locked door, a secret door, an archway, a portcullis, a window or an inner wall. **Furnish** shows every piece as a picture: furniture, fittings, dressing (torches, lanterns, candles, bones, cobwebs, banners…) and outdoor things (trees, bushes, boulders, tents, carts, campfires); your own art library is there too, placed as props. R turns a piece, Delete removes it. *Number rooms* numbers each room; the numbers sit on the GM layer (only you see them, and only while you're on it) unless *Plan…* says everyone may. Click a number for the room's notes: its name and what's there, kept with the map; *To chat* reads them out. The walls and doors are made from the plan, so sight works straight away; secret doors look like wall to players. Every torch, lantern, brazier, fireplace, campfire, candle and cauldron on the plan gives light by itself (and lava glows): put one down and the light comes with it, take it away and the light goes. Change a plan light with the lights tool and it keeps your changes; delete one and it stays off. *Generate a map…* (here, or *Generate a map* in the New scene window) makes one for you: a dungeon (rooms and corridors, caves, or both; a tomb, temple, stronghold, lair, mine, sewer, wizard's vaults or prison, each with its own floors, furnishings and dressing), or a building (a tavern, house, shop, manor, chapel, smithy or guardhouse, with its rooms, inner walls, windows, a yard and a name). Each room is laid out to be what it is: beds with their heads to the wall and a chest at the foot, a bar with the barrels behind it, booths and tables in a common room, an altar on the far wall with pews facing it, a throne with banners and a rug before it, shelves round a library, crates heaped in a storeroom's corners. A way is kept clear between each room's doors and nothing stands in a corridor. Guards are near the way in, treasure and the grand rooms deep inside, the kitchen off a tavern's common room, bedrooms furthest in. Every room that's used is lit (torches on the walls, fires, lanterns, campfires in the caves; corridors get the odd torch), and each room's name and description go with its number (and in the scene's notes). *Containers with loot* puts chests, barrels, crates and sacks to suit each room (a storeroom's crates, a bedroom's chest, a treasury's locked coffers) on the token layer, at their real size and off the grid, each filling from a fitting loot table the first time it's opened. *Weather and time of day* (buildings) shows the clock's weather round it and lets the light follow the hour. *Plan…* sets the style, floor, walls and what's outside, resizes it, or exports a PNG as the players see it (*GM copy*: with the numbers and secret doors). *History…* lists every change to the plan in words, who made it and when, and puts any version back. Two GMs can work on one plan at once: what each changes (squares, doors, furniture, room notes) is put together, and where both changed the same square, the later one wins.
- **Layers** (Map / Tokens / GM, bottom left of the map, or L to go round them, GM): the **map layer** is the map and scenery you lay down: it sits in the light and dark like the map itself, under everything. On it, a planned map's furniture can be picked up where it lies: drag it to another square, R turns it, D copies it, Delete takes it away (the bar beside the switch shows what's picked up; *+ Furniture* puts new pieces down). The **token layer** is what's in play, and the only one players ever work on: their tokens always live there. The **GM layer** only you see (hidden monsters, traps, room numbers and their notes). You work on one layer at a time: only its things can be picked up. Move something to another layer from its settings, or the order button in its ring of tools.
- **Time of day**: a scene whose light follows the clock takes the colour of the hour (gold at sunrise and sunset, rose then blue at dusk, a cool blue at night), and one showing the weather greys under cloud, rain and snow. Ticking the weather in the New scene window ticks the time of day too.
- **Indoors**: on a scene showing the weather, it doesn't rain or snow inside. Rooms closed in by walls (doors and windows count as shut) are found by themselves and the weather stops at their walls; on a planned dungeon, under rock is indoors too.
- **Scene pictures**: the Scenes list shows a small picture of each map, made when you first look at a scene and again whenever a planned map changes.
- **Containers** (chests, barrels, crates): *Snap to grid* in its settings (off for the generator's): off, it goes exactly where it's put and stays its own size. In a container's settings put item cards in by hand (search, or drop a card on it), or pick a **loot table**: it rolls when someone first opens it, or press *Roll now*. Lock it to keep players out. Players click a container to look inside and take things into their character's inventory; they don't see what's in it until they open it. A gold mark on the corner (GM only) shows how many things are in it (? when it hasn't rolled yet).
- **Loot tables** (the art panel, or a container's settings): presets made from the SRD items (odds and ends, a bandit's stash, an adventurer's leavings, an armoury rack, an alchemist's shelf, a minor magic item, a rare hoard, a coin purse, kitchen stores, cellar stores, a scholar's desk, temple offerings, tools and stock, personal belongings, grave goods), and your own: how many draws (a number or dice), the items with how likely each is and how many (1d6), and coins. *Copy to edit* starts one from a preset.
- **Chat dividers**: the —§— button by the dice (or `/divider`, or `/divider Session 12` for a named one) puts a line across the chat, to separate sessions or blocks of rolls. The GM button beside it makes your rolls GM-only.
- **Who's here**: the little discs by the connection light at the top show who's at the table; you're told when someone joins or leaves.
- **Hours played**: by your name in the top bar, it counts up while you have the site or the table open. The GM sees each player's in the Players tab.
- **A GM as a player** (Players tab): someone whose account is a GM's (a co-GM of the world) can be a player in one campaign: choose *Player here* by their name (a GM's account that comes in by a player's invite is one already). There they see and do only what a player would; everywhere else, and on the map and wiki, they're still a GM.
- **Rejoin as player** (top bar, GM): sit at a table as a player, seeing only what players see; *Rejoin as GM* to go back.

## Controls

V select   R ruler   T templates   F fog (GM)   W walls (GM)   B lights (GM)   N sounds (GM)   A art (GM)   P room planner and map generator (GM)   1–9 action bar

L next layer: map, token, GM (GM)   0 fit the map Drag a token to move it (snaps to the grid; hold Alt not to). Double-click a token to open its character sheet (tokens without one open their settings; E always opens settings). Right-click a token for its ring of tools: hit points above it (type -7 to hurt, +3 to heal), and buttons either side for its sheet and inventory, settings, initiative, light (candle, torch, lantern), conditions, look, hide, order, copy and delete. Buttons that change things apply to every selected token.

Look (GM): a round token with a ring, or the bare picture with no ring (for sprites); picture size; how many squares it covers; Pixel art keeps scaled sprites crisp. [ and ] shrink and grow the selected tokens' pictures (Shift: finer). A scene can start its tokens without rings: Scene settings > Tokens.

Hold the mouse still for half a second to ping. GM: hold Shift too and everyone's view jumps there.

Right-drag, middle-drag or Space+drag to pan; scroll to zoom.

Delete removes the selected tokens (GM) or your selected template. Ctrl+Z / Ctrl+Y undo and redo.

Arrow keys nudge selected tokens a square at a time.

Drop image files onto the map to make tokens or scenery (GM).

## Chat
Point at a message for its delete button (the GM can delete any message, players their own). The bin button by the dice clears the whole log (GM).

- `/r 1d20+5 Perception` roll (anything after the dice is a label)

- `/gr 2d6` roll only the GM sees

- `/w Sean text` whisper ("/w "Two Words" text" for names with spaces)

- `/me draws her sword` action 2d20kh1 keeps the higher (advantage), 2d20kl1 the lower; 3d6kh2 is 2D6 advantage.

## Walls, doors, lights and sight (GM)

Walls tool (W): click to start a wall and click for each corner; double-click or Esc to stop. Ends snap to grid corners and edge middles (hold Alt not to) and to other walls' ends. Pick Wall, Door, Secret door, Window, Invisible or One-way first, or click a wall to select it and change it. Drag a wall's end to move it: walls joined there follow. Delete removes the selected wall.

- Door: anyone can open or close it with the little button on it, unless you lock it.
- Secret door: players see and bump into a plain wall until you open it.
- Window: you see and light shines through it, nobody walks through. Invisible: the same, but not drawn.
- One-way: blocks from one side only (the tick shows which; Flip side swaps it).
- Blocks light (house walls): light stops at it and nobody walks through. Players still see the map beyond it (the
  building, the street) but not the tokens behind it, so nobody spots someone around a corner.
Lights tool (B): click to place a light, drag to move it; set bright and dim reach (feet), colour, a cone, and a flicker (torch, candle, pulse, fairy, sunbeam). Tokens can carry light too: right-click the token.

Sight on (in either tool's bar): players see only what their own tokens can see. Below a third darkness everyone sees in their tokens' line of sight; darker than that they need light or darkvision (token settings: at full darkness, anything unlit is pitch black;

Sight, Range, Darkvision). Tokens they can't see aren't sent to them at all. What they've seen stays dimly on their map; Forget explored wipes it. View as <player> shows you the map through their eyes.

Click any token (an NPC too, no setup needed) to see exactly what it sees: the dark is as black as the player gets, and tokens it can't see vanish. Click empty floor to see everything again. *See in the dark* (in the walls and lights bars) lets you see dimly into darkness while you run the game; switch it off to see the scene as dark as the table does.

Players can't walk their tokens through walls or closed doors.

## Journal

Characters and handouts, sorted into folders (New folder; drag things onto a folder).

Whoever makes a character owns it. Under each character's name is who plays it: *Yours*, *Played by …*, or *Unowned*. GM: under each character's name is who plays it; click it and tick a player to give it to them (their tokens of it follow). Your characters in your other campaigns are in *Other Campaigns* at the bottom, a folder for each campaign: open a sheet from there, or *Copy here* to bring a copy into this campaign.

Handouts: a picture and text (Markdown) with GM notes players never see. Choose who sees each one, or press the eye button to show it to everyone at once. Any sheet or handout can be popped out into its own window.

## World map and wiki

The world map is a scene in every campaign (Scenes tab): move the players onto it like any other scene.

The Map and Wiki buttons at the top show either one to you without moving anyone; Tabletop goes back. On a world map scene the speaker at the bottom of the tools sets the map's own sound (rain, wind, the sea, thunder).

Drag a character from the Journal onto the world map scene for a party token; drag tokens to move them (players move their own) and the ruler shows how far and how long the trip takes; click the map to put it away. Double-click a token for its sheet, right-click for quick tools. The Edit map switch (top right) edits the map.

On the map, the bar on the left has the Ruler (R) and Borders (B).

## Jukebox (Jukebox tab)

Drop sound files on it (MP3, OGG, WAV, M4A, FLAC), or onto a folder. Sort sounds into folders by dragging.

A folder plays on its channel (click its Music / Ambience / Effects label to change), in order or shuffled; an Effects folder is a soundboard of pads. 🎧 listens to a sound on your own. Double-click names to rename.

Music and Ambience play on their own channels together, crossfading when they change; everyone hears the same moment. Playlists play in order or shuffled. Effects are the soundboard: one click plays them once for everyone.

The sound library is shared by all your campaigns: a sound uploaded in one can be played in any of them.

Presets remember what music and ambience are playing ("Tavern at night") and bring it back in one click.

Everyone has their own volume sliders at the bottom of the tab. Browsers won't play sound until you've clicked the page once: players who joined late see a "Join audio" button at the top.

## Items (Items tab)

Every item in the D&D 5e SRD (weapons, armour, gear, tools, mounts, magic items) is a card. They sit in folders (Weapons › Martial Melee, Armour, Adventuring gear, Magic items by rarity…); search, click one to see it close up, click the card to show it in the chat.

Drag a card onto a character in the Journal, onto their open sheet, onto their token or into their inventory: it goes into their bag, and their sheet gets an inventory row (and an attack, for a weapon).

The bag button (in the Journal, a sheet's title bar or a token's ring) opens a character's inventory: click a card to give it to someone, drop it on the map, add notes or take it out.

GM: drag a card onto the map for loot. Anyone can click loot to see its card and pick it up (or drag the card onto their token). New card makes your own items; Copy to edit starts from an SRD one. **Import** (GM) brings in a .json file of cards (a list of cards, or `{ "items": [...] }` in the same shape a card has) into this campaign's Homebrew; a card whose name is already there is skipped.

## Spells (Spells tab)

Every spell as a card, in folders by level; search by name, filter by class. Click one to see it close up and show it in the chat, or add it to a character's spell list. Drag a spell onto a character (Journal, open sheet or token) to put it on their sheet.

The table comes with the 319 SRD 5.1 spells. **Import** (GM) brings in spells from your own copies of other books (5etools spell files, the 5e-database format) or a file exported from another table; they stay on your server. *New spell* makes homebrew ones.

## Character sheets

The ⇄ button in a 5e sheet's title bar switches it between the Community and Legacy sheets; scores, skills, hit points, class and level, weapons, spells, gear and notes come along. ☾ switches the sheet's night mode.

## Import from Foundry (Scenes or Journal tab)

In Foundry, right-click a scene or an actor in the sidebar > Export Data, then pick those .json files.

Scenes bring their map, grid, walls and doors, lights and tokens; D&D 5e actors become characters on the sheet you choose, and their tokens are linked to them. Pictures are copied from Foundry's data folder on this PC (usually %LOCALAPPDATA%\FoundryVTT\Data); any it can't find are listed, and you can pick them with the files.

Ctrl+Z undoes a whole import.

## Import from Roll20 (Journal tab)
Roll20 has no export of its own, so use a browser extension: **VTT Enhancement Suite** (open a character, then Export in its journal menu: one .json each) or **R20Exporter** (the whole campaign as a .zip: unzip it and pick campaign.json). Pick the files at the bottom of the Journal > Roll20.

Characters keep their attributes exactly as they were (the table runs the same Roll20 sheets; it works out which 5e sheet from the attributes, or you choose), and a bio becomes a handout beside them. Handouts come with their text and picture. Pages become scenes: the biggest picture on the map layer is the map, the grid and its scale come over, walls (and the newer doors and windows) become walls and doors, and tokens keep their pictures, size, hit points (bar 1) and the character they stand for. Pictures are fetched from Roll20 by the table's computer; any that can't be are listed.

## Layout

The button at the top right (or the \ key) hides the side bar. Double-click a sheet's or handout's title bar to fold it away; double-click again (or open it again) to unfold it.

