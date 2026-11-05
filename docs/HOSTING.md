# Hosting

The site is one Node.js program (`server/server.js`) and a folder of data (`vtt-data`). It compresses what it sends and lets browsers keep what hasn't changed, so pages open quickly even over a home connection. It needs no database and nothing
to install from npm. Pick whichever of these suits you.

## At home

Run `start.bat` (Windows) or `./start.sh` (macOS, Linux). People on your own network can join with the addresses it
prints. The computer running it must stay on while people use it.

**For a session with people elsewhere,** run `share.bat` too (it needs Cloudflare's free `cloudflared`:
`winget install --id Cloudflare.cloudflared`). It prints a `https://….trycloudflare.com` address; paste it into
**Table › Players › Where players connect** so invite links use it. The address changes every time.

## On a server, always on

Any small Linux server works: 1 CPU and 1–2 GB of memory is plenty for a group (Hetzner, DigitalOcean, Linode, OVH and
others rent them for a few pounds/dollars a month). Choose Ubuntu 24.04.

1. Copy this folder to the server, or clone the repository there:
   ```
   git clone <this repository> valanar-table && cd valanar-table
   ```
   Moving an existing site? Bring your `vtt-data` folder, `tiles` folder and `mapinfo.js` along inside it.
2. Run the setup script:
   ```
   sudo bash deploy/setup-ubuntu.sh                       # free address: 203-0-113-5.sslip.io
   sudo bash deploy/setup-ubuntu.sh table.example.com     # your own domain (point its DNS A record at the server first)
   ```
   It asks for an admin name and password, then installs Node.js and [Caddy](https://caddyserver.com) (which fetches and
   renews the HTTPS certificate), sets the site up as a service that restarts by itself, and turns the firewall on
   (SSH, HTTP and HTTPS only). Without a domain it uses `<your-ip>.sslip.io`, a free name that always points at that IP.
3. Open the address it prints and log in.

The site lives in `/opt/valanar/app`, its data in `/opt/valanar/data`. Useful commands:
```
sudo systemctl restart valanar        # restart
journalctl -u valanar -f              # the log
sudo bash deploy/setup-ubuntu.sh      # after pulling a new version (from the folder): updates the code, keeps the data
```

### Settings

The service reads `/etc/valanar.env`:

| Setting | Meaning |
|---|---|
| `VTT_DATA` | where the data lives |
| `VTT_HOST` | `127.0.0.1` so only Caddy can reach the site's port |
| `VTT_PORT` | the port (8642) |
| `VTT_NO_LOCAL_LOGIN` | nobody is logged in automatically (on your own PC, the admin is) |
| `VTT_ADMIN_NAME`, `VTT_ADMIN_PASSWORD` | the first admin's login, set at start-up; delete the password line after your first login if you like |

## With Docker

```
docker build -t valanar-table .
docker run -d -p 8642:8642 -v valanar-data:/data -e VTT_ADMIN_PASSWORD=change-me valanar-table
```

For HTTPS, `deploy/docker-compose.yml` runs the site behind Caddy: put your address in `deploy/Caddyfile`, choose the
admin password in the compose file, then `docker compose -f deploy/docker-compose.yml up -d`.

## Visitors

**Admin › Open to visitors** lets anyone with the address read the map, the wiki and the files that aren't GM only,
without logging in (handy for a public world). The table always needs a login, and nobody but admins can change anything.

## Backups

**Admin › Download a full backup** gives you everything (accounts, campaigns, map, wiki and its history, files) as a
.zip. Or copy the data folder. The map keeps its last 30 versions, every campaign its last 30 saves, and every wiki
page its last 100 versions.

To restore, stop the site, put the backup's contents into the data folder, and start it again.

## Your map tiles

The tiles (`tiles/`) and `mapinfo.js` sit beside the code, not in the data folder: they come from your map picture
(`tools/make_tiles.py`). On a server, upload them with the code (or tile on the server: it has Python).
