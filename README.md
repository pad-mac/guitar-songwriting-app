# Chords

A lean guitar chord songwriting app. Pick notes on the fretboard and get the chord names.

Version 0.1, the analyzer only. Saving songs and progressions comes in the next pass.

- **Fretboard**: tap a fret to place a note, tap it again to mute the string. The row above the nut is for open strings.
- **Names**: one name per sounding note taken as the root. The name on the bass note comes first, then the others from simplest to most involved. Tap a name to read the fretboard from that root.
- **Notes / Intervals**: what the dots show. The row under the board shows the other.
- **Lower / Higher**: moves the whole shape a fret down or up, open strings included.
- **Tunings**: 13 presets, plus your own (Copy a preset, or New tuning). They are kept in the browser for now.
- Keys on a computer: ← ↑ lower, → ↓ higher, `I` notes/intervals, `T` tunings, `1`–`9` pick a name, Backspace clears.

Names follow Oolimo's style (`Cmaj7(9)`, `D7sus2(13)`, `Bm(addb9,add11)`), spelled with sharps only. No chord table is involved: `web/js/chords.js` builds each name from the intervals. `npm test` checks it against the five shapes from the Oolimo screenshots plus everyday chords, and runs every set of up to six notes once to make sure each gets a name.

## Install on the server

Next to the News Reader on the same VPS. The reader uses port 8080, this app uses 8081.

```sh
cd ~
git clone https://github.com/pad-mac/guitar-songwriting-app.git
cd guitar-songwriting-app
sudo docker compose up -d --build

sudo docker compose logs --tail 3     # "Chords 0.1.0 on http://0.0.0.0:8080" (inside the container)
curl -s 127.0.0.1:8081/healthz        # {"ok":true,...}
```

The app listens on `127.0.0.1:8081` only. Put HTTPS in front the same way as the reader.

### Tailscale (if the reader runs that way)

```sh
sudo tailscale serve --bg --https=8443 8081
sudo tailscale serve status
```

The app is then at `https://<server>.<tailnet>.ts.net:8443`. The reader stays on port 443.

### Caddy (if the reader runs that way)

Point a second hostname at the server (for example another DuckDNS name) and add a block to `/etc/caddy/Caddyfile`:

```
chords.example.org {
	reverse_proxy 127.0.0.1:8081
}
```

```sh
sudo systemctl reload caddy
```

There is no password yet: it stores nothing on the server. A password arrives with saving, like the reader's.

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
npm start          # http://localhost:8080
npm test
```

No build step: `web/` is served as it is.
