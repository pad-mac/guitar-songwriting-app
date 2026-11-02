# Chords

A lean guitar chord songwriting app. Pick notes on the fretboard and get the chord names.

Version 0.2: songs are saved on the server, behind a password.

**Songs**
- The first screen lists all songs with their created date and time and the first chord names. The pencil renames a song; + starts a new one.
- A song shows its chords as cards, two per row on the phone: the name, and the shape cut down to the frets it uses, numbered on the left. Open and muted strings sit on a line above the cut-out, wherever on the neck it is.
- The tuning button on a song changes the tuning for all its chords. + adds a chord at the end. "Delete song" is at the bottom.
- Tap a card to open it in the analyzer.

**Analyzer on a song**
- ‹ and › go to the previous and next chord. On the last chord, › becomes + for a new one at the end.
- Hold ‹ or › (half a second, the line under the arrow fills) to put a new chord before or after the current one.
- Changes only reach the song with **Save**, which stays grey until something differs from the saved chord. Choosing another name counts as a change, and is what the card shows. Leaving with unsaved changes asks first.
- The bin deletes the chord.
- Keys: `[` `]` previous/next, `{` `}` new chord before/after, ⌘S / Ctrl+S saves.

**Analyzer on its own** ("Analyzer" on the songs screen), as in 0.1:
- **Fretboard**: tap a fret to place a note, tap it again to mute the string. The row above the nut is for open strings.
- **Names**: one name per sounding note taken as the root. The name on the bass note comes first, then the others from simplest to most involved. Tap a name to read the fretboard from that root.
- **Notes / Intervals**: what the dots show. The row under the board shows the other.
- **Lower / Higher**: moves the whole shape a fret down or up, open strings included.
- **Tunings**: 13 presets, plus your own (Copy a preset, or New tuning). Own tunings are stored on the server, so every device has them.
- Keys: ← ↑ lower, → ↓ higher, `I` notes/intervals, `T` tunings, `1`–`9` pick a name, Backspace clears.

**Password**: the first visitor chooses it, so open the address yourself right after installing. Or set `APP_PASSWORD=…` in a `.env` file next to `docker-compose.yml` before the first start. Each device signs in once and stays signed in.

**Data**: everything is in `data/chords.db` in the app folder (SQLite). Back that folder up. Updates never touch it.

Names follow Oolimo's style (`Cmaj7(9)`, `D7sus2(13)`, `Bm(addb9,add11)`), spelled with sharps only. No chord table is involved: `web/js/chords.js` builds each name from the intervals. `npm test` checks it against the five shapes from the Oolimo screenshots plus everyday chords, and runs every set of up to six notes once to make sure each gets a name.

## Install on the server

Next to the News Reader on the same VPS. The reader uses port 8080, this app uses 8081.

```sh
cd ~
git clone https://github.com/pad-mac/guitar-songwriting-app.git
cd guitar-songwriting-app
sudo docker compose up -d --build

sudo docker compose logs --tail 3     # "Chords 0.2.0 on http://0.0.0.0:8080" (inside the container)
curl -s 127.0.0.1:8081/healthz        # {"ok":true,...}
```

The app listens on `127.0.0.1:8081` only. Put HTTPS in front the same way as the reader.

### Tailscale (if the reader runs that way)

```sh
sudo tailscale serve --bg --https=8443 8081
sudo tailscale serve status
```

The app is then at `https://<server>.<tailnet>.ts.net:8443`. The reader stays on port 443.

### Caddy with a DuckDNS name (if the reader runs that way)

1. On duckdns.org, add a second subdomain (for example `<name>-chords`) and give it the server's IP, the same as the reader's. Check: `dig +short <name>-chords.duckdns.org`.
2. Look up the reader's hostname: `cat /etc/caddy/Caddyfile`.
3. Write both sites into the file. With two sites each needs its own braces; the reader's two-line form only works when it is the only site.

```sh
sudo tee /etc/caddy/Caddyfile > /dev/null <<'CADDY'
<reader-name>.duckdns.org {
	reverse_proxy 127.0.0.1:8080
}

<name>-chords.duckdns.org {
	reverse_proxy 127.0.0.1:8081
}
CADDY
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy fetches the certificate on the first visit (a few seconds).

### On the phone

Open the address in Safari, then Share → **Add to Home Screen**.

### Updates from GitHub, automatically

Once, after the install above:

```sh
cd ~/guitar-songwriting-app && git pull && sudo sh deploy/install-autoupdate.sh
```

A systemd timer then checks GitHub every minute. When `main` has a new commit, it resets the folder to it and rebuilds. The build runs the tests first; if they fail, nothing is replaced and the running version stays up. It also starts the app again if it isn't running.

```sh
journalctl -u chords-update -n 20      # what it deployed, and build errors
curl -s 127.0.0.1:8081/healthz         # "commit" = the version that is live
sudo sh deploy/update.sh               # update right now instead of waiting
sudo systemctl disable --now chords-update.timer   # switch it off
```

The folder belongs to the timer: changes made there by hand are overwritten on the next update. The phone picks up a new version the next time the app is opened.

## Run it locally

```sh
npm install
npm start          # http://localhost:8080, data in ./data
npm test           # chord names + server API
```

No build step: `web/` is served as it is.
