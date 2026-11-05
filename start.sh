#!/bin/sh
# Starts the site (map, wiki, files and the table). Open http://localhost:8642/ once it says it's running.
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js 18 or newer is needed: https://nodejs.org"; exit 1; }
exec node server/server.js
