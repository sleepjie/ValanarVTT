# Getting started with your own world

This guide takes you from nothing to a running site with your map, your places and your players. It takes about
half an hour, plus however long your map takes to export. There are more details in [Your world](YOUR-WORLD.md)
and [Hosting](HOSTING.md).

## 1. Run it on your computer

1. Install [Node.js](https://nodejs.org) (version 18 or newer). You don't need anything else.
2. Download this repository: use **Code › Download ZIP** and unzip it, or run `git clone`.
3. Start it:
   - **Windows:** double-click `start.bat`.
   - **Mac or Linux:** run `./start.sh`, or `node server/server.js`.
4. Open **http://localhost:8642/**.

The first time, you get a small example world so you can see how everything fits together. On the computer that
runs the site you're the admin automatically: no password needed.

> Everything the site keeps (accounts, campaigns, map edits, wiki pages, uploads) lives in the `vtt-data` folder.
> That folder is your world, so back it up. **Admin › Download a full backup** saves the whole thing as one file.

## 2. Name your site

Go to **Admin › The site** and set the name (shown in the top bar and the browser tab), a tagline, and the wiki's
front page. Turn on **Private** if only people with an account should see anything.

## 3. Put your map in

1. Export your map as **one big PNG**. Wonderdraft, Inkarnate, Photoshop or a scan all work. Bigger means more detail
   when people zoom in: 10,000 to 30,000 pixels across is a good range.
   - **Tip:** export it without settlement icons and names. You'll place those on the site, where they stay sharp at
     every zoom and people can click them.
   - **Tip:** a **transparent sea** lets the site draw its animated sea under your coastline and keep borders on land.
2. Cut the map into tiles:
   - **Windows:** drag the PNG onto `make_tiles.bat`. It fetches the tiling tool the first time.
   - **Anywhere:** run `python tools/make_tiles.py my_world.png`.
3. Reload the site. Your map replaces the example.

## 4. Set the scale

Open **Map settings** (the sun icon in the left-hand bar) and set **miles per pixel**. The easiest way is to measure
something you know with the ruler (**R**) and adjust until it reads right. The ruler's travel times on foot,
horseback, by cart and by ship all follow from it.

## 5. Add places

Switch **Edit map** on (top right). Then:

- **Place:** pick an icon from the palette and click the map. Drag a place to move it; click it to edit its name, type,
  nation, details and notes, or link it to a wiki page.
- **Types:** set each kind of place (city, town, village, ruin…): its icon, its size, the zoom levels where it shows
  and where its name appears, and a **lettering preset** (italic, bold, small caps, spacing, halo, ink).
- **Name-only places** (the *Aa* buttons) are names with no icon, for regions and landmarks. They can be rotated and
  curved along an arc.
- **Names:** curved names for seas, bays, lakes and rivers, and for mountain ranges, forests and regions. Drag their
  points so a name follows a river or a range.
- **Several at once:** Ctrl+click places to select more than one and change them together. Where they differ, a field
  shows `[...]` until you set it. **Ctrl+C / Ctrl+X / Ctrl+V** copy, cut and paste places at the mouse;
  **Ctrl+D** duplicates; **Ctrl+Z** undoes.
- **A spreadsheet of settlements?** **Import CSV** brings them in as *Unplaced*, ready to drop onto the map.

Every change saves to the server as you go, and the last 30 versions are kept (**History**).

## 6. Borders and nations

**Borders** in the edit bar: make a nation, give it a colour, and draw its border or claim land by clicking. The
political view (the map icon in the left-hand bar) shades each nation.

## 7. Write the wiki

Open **Wiki** and start writing. Pages are laid out like Wikipedia, with infoboxes, references and categories. You
can also bring in what you already have:

- **Google Docs:** paste the link (pictures come too).
- **Word or Markdown files.**
- **An Obsidian vault:** zip the folder and upload it.

Mark anything **GM only** (a whole page, or single paragraphs) and the server leaves it out for players.

## 8. Invite your players

1. Open **Tabletop** and make a campaign: D&D 5e, or the 2D6 system.
2. Go to **Players › New player invite** and send them the link. Each player sets their own password.
3. Set yourself a password too (**Players**), so you can log in from other devices.

In the campaign:

- **Characters:** make characters in the Journal, or bring them in from D&D Beyond, Roll20 or Foundry.
- **Tokens:** give a character a picture and their token is made for you, round and framed, the first time you place
  them. **Adjust the token** in their settings lets you frame the face and choose a frame.
- **Scenes:** make scenes from battle maps, or from the world map itself.

## 9. Put it online

- **For one session from home:** `share.bat` gives you a temporary public address.
- **Always on:** rent a small Linux server (a few pounds or dollars a month) and run
  `sudo bash deploy/setup-ubuntu.sh`. It sets up HTTPS, a free address (or your own domain), a firewall and restarts.
  On Windows, `go_live.bat` does all of this from your PC and sends later updates as just the files that changed.

See [Hosting](HOSTING.md) for Docker, backups and moving data between your PC and the server.

## Make it look like yours

Everyone picks their own **colours** with the palette button in the top bar: a dark or light theme, and an accent
colour. The site's name and front page come from **Admin**, and your map, icons and lettering do the rest. To use
your own icons, put PNGs in the `icons/` folders and press **Rescan icons**.

## Stuck?

- **The map is blank:** check that `tiles/` and `mapinfo.js` were written by the tiler, then reload with Ctrl+F5.
- **"Opened as a file":** open the site through **http://localhost:8642/**, not by double-clicking `index.html`.
- **You lost admin:** on the computer running the site you're always the admin at http://localhost:8642/.
- Everything else: the [User guide](USER-GUIDE.md) covers each part of the site.
