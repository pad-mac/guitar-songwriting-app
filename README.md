# Chords

A lean guitar chord songwriting app. Pick notes on the fretboard and get the chord names.

Version 0.3: songs are saved on the server, behind a password.

**Songs**
- The first screen lists all songs with their created date and time and the first chord names. **Unsorted** sits on top: chords saved from the free analyzer without a song.
- The pencil renames a song. Hold a song (right-click on a computer) for Rename and Delete. + starts a new song.
- A song shows its chords as cards, two per row on the phone: the name, and the shape cut down to the frets it uses, numbered on the left. Open and muted strings sit on a line above the cut-out, wherever on the neck it is.
- **+ Section** adds a named separator (Verse, Chorus…). Tap its name to rename it.
- Drag cards and sections to reorder them. On the phone: hold until the card lifts, then move it. Holding without moving opens a menu: move the chord to another song or to Unsorted, or delete it. On a computer: drag with the mouse, right-click for the menu.
- The tuning under the title changes the tuning for all chords of the song. Chords in Unsorted keep the tuning they were saved with.

**Analyzer on a song**
- ‹ and › go to the previous and next chord (sections are skipped). On the last chord, › becomes + for a new one at the end.
- Hold ‹ or › (half a second, the line under the arrow fills), then let go: choose **New chord** or **Duplicate this chord**, before or after the current one. Holding the + on the last chord works the same way. A duplicate opens unsaved, so you can change it before saving.
- Changes only reach the song with **Save**, which stays grey until something differs from the saved chord. Choosing another name counts as a change, and is what the card shows. Leaving with unsaved changes asks first.
- The bin deletes the chord.
- Keys: `[` `]` previous/next, `{` `}` new chord before/after, ⌘S / Ctrl+S saves.

**Analyzer on its own** ("Analyzer" on the songs screen):
- **Save chord…** puts the chord into Unsorted, or at the end of a song. If that song is in another tuning, it asks first: the shape is saved as it is, so its notes follow the song's tuning.
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

On the VPS (Ubuntu or Debian), next to the News Reader if it is there. You need the DuckDNS name and the token shown at the top of duckdns.org.

```sh
sudo apt update && sudo apt install -y git
git clone https://github.com/pad-mac/guitar-songwriting-app.git
cd guitar-songwriting-app
sudo sh deploy/setup-server.sh guitarwriter YOUR-DUCKDNS-TOKEN
```

`deploy/setup-server.sh` points the DuckDNS name at the server, installs Docker if needed, builds and starts the app on `127.0.0.1:8081`, turns on the automatic updates, and sets up Caddy for HTTPS. A site already in the Caddyfile (the reader) stays; the old file is kept as `Caddyfile.bak.<date>`, and if the new one does not validate, the old one is put back. It also opens ports 80 and 443 if ufw is active. Running it again is harmless.

Then open `https://<name>.duckdns.org` and choose the password.

With Tailscale instead of a public name: skip the script's Caddy part by running only `sudo docker compose up -d --build` and `sudo sh deploy/install-autoupdate.sh`, then `sudo tailscale serve --bg --https=8443 8081`.

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
