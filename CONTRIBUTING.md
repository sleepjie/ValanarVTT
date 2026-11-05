# Contributing

Thanks for wanting to help. Bug reports, fixes, sheets for other systems, translations and docs are all welcome.

## The shape of it

Plain JavaScript everywhere: no build step, no framework, no npm install. Edit a file, reload the page.

```
server/
  server.js        accounts, sessions, campaigns, the table's live state (WebSocket), uploads, rolls
  site.js          the world site: map data, wiki pages and history, the drive, admin, document import
  compendium.js    spells brought in by the GM (other books, homebrew)
  foundry.js       reading Foundry VTT exports
  node_modules/ws  the one dependency, vendored
index.html, app/   the world site in the browser
  app.js           the map (Leaflet): places, borders, ruler, editing; routes between the views
  wiki.js          wiki pages, editor, history, import
  drive.js         the Files view
  admin.js         the Admin view
  sky.js           night, dawn and dusk and the weather over the map; the clock button
  maptools.js      routes, water names and Map settings
  calendar.js      the Calendar view
table/             the virtual tabletop
  js/core.js       connection, state, events      js/stage.js   the battle map (PixiJS)
  js/lighting.js   walls, lights, sight            js/chars.js   journal, sheets
  js/cards.js      item cards                      js/audio.js   jukebox
  js/spells.js     spell cards                     js/clock.js   the world's clock at the table
  js/sheetrt.js    runs Roll20-format character sheets (sheet workers, roll templates)
  shared/          code both server and browser use: dice, geometry, vision, roll parsing, 5e sheet conversion,
                   the calendar, the weather animation
  sheets/          character sheets, listed in registry.json
tools/             map tiling, building item cards and sheets
```

The server is the authority: every change is an operation (`room.edit` for the table, the `/api/site` routes for the
site) checked for permission, applied, and recorded with its inverse for undo. Players are only ever sent what they're
allowed to see (hidden tokens, GM-only pages and paragraphs, secret doors are filtered on the server).

## Adding a character sheet

Sheets use Roll20's format (HTML with `attr_` fields, roll buttons, sheet workers and roll templates), so many of the
[Roll20 community sheets](https://github.com/Roll20/roll20-character-sheets) work with little or no change. Put
`sheet.html`, `sheet.css` and `templates.html` in `table/sheets/<name>/` and add it to `registry.json` (its name, its
game mode, and which attributes hold hit points). Keep the sheet's licence file with it.

## Style

Small functions, comments that say why, user-facing text in plain words. Test in Chrome or Edge and Firefox.
Run the server with `VTT_DEBUG=1` to log the stack of any error a request hits.

## Licence

By contributing you agree your contribution is released under the project's licence, the GNU AGPL-3.0.
