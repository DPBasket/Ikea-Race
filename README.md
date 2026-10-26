# IKEA RACE 🛒🏁

Gioco di kart multiplayer in tempo reale, in 3D stile Mario Kart, dentro un negozio IKEA.
Lo schermo grande (proiettore) mostra tutto il negozio dall'alto, ogni telefono ha la visuale da dietro il proprio kart.

**Stack:** Node.js · Express · Socket.io · three.js per la grafica 3D (vanilla JS, nessun game engine). Fino a 20 giocatori, 20 colori. Tutto in memoria, una stanza sola.

## Online (consigliato): nessuna installazione per chi gioca

Il progetto è pronto per **Render** (gratis). Una volta pubblicato, chi gestisce lo schermo apre solo il link
`https://<nome>.onrender.com` nel browser, e i telefoni scansionano il QR (HTTPS vero: niente avvisi, giroscopio subito attivo).

1. Carica questi file in un repository GitHub (anche dal sito: "Add file" → "Upload files")
2. Su render.com: **New → Web Service** → collega il repository
3. Build command `npm install` · Start command `npm start` · Instance type **Free** → Create

Il piano gratuito "si addormenta" dopo ~15 minuti senza uso: aprire il link qualche minuto prima di giocare
(il primo caricamento dura circa un minuto).

## Avvio in locale

```bash
npm install
npm start          # oppure: npm run demo  (parte già con 3 bot in lobby)
```

Poi apri sul computer collegato al proiettore:

```
http://localhost:3000/host.html
```

Sull'host compaiono **codice a 4 cifre** e **QR code**. I telefoni devono essere sulla **stessa rete Wi-Fi** del computer.

### Perché HTTPS sui telefoni

iOS e Android danno accesso al giroscopio **solo su HTTPS**. Per questo il server avvia anche
`https://<IP-del-PC>:3443` con un certificato self-signed generato al volo, e il QR punta lì.

La prima volta il telefono mostra un avviso di sicurezza:
- **iPhone (Safari):** "Mostra dettagli" → "visita questo sito web"
- **Android (Chrome):** "Avanzate" → "Procedi"

Alternative senza avviso: un tunnel HTTPS (es. `cloudflared tunnel --url http://localhost:3000`)
e poi `PUBLIC_URL=https://xxxx.trycloudflare.com npm start` → il QR userà quell'indirizzo.
Senza HTTPS il gioco funziona lo stesso, ma lo sterzo passa ai pulsanti ◀ ▶.

| Variabile | Default | Cosa fa |
|---|---|---|
| `PORT` | 3000 | porta HTTP (host) |
| `HTTPS_PORT` | 3443 | porta HTTPS (telefoni) |
| `PUBLIC_URL` | – | URL pubblico da mettere nel QR (disattiva l'HTTPS locale) |
| `--no-https` | – | flag: niente server HTTPS |

## Demo mode (senza telefoni)

Nella lobby dell'host:
- **+ 3 BOT DEMO** aggiunge piloti finti guidati dal server (raccolgono e usano power-up, sabotano quando arrivano)
- **▶ GARA DEMO** aggiunge i bot se mancano e parte subito sulla pista selezionata
- **RIMUOVI BOT** li toglie

Puoi anche guidare dal PC: apri `http://localhost:3000/player.html` in un'altra finestra e usa
**↑ / W** gas, **← → / A D** sterzo, **SPAZIO** power-up, **C** per prendere il gelato.

## Come si gioca

1. Host apre la pagina → codice + QR
2. I giocatori scansionano il QR, scrivono il nome, scelgono il colore (il tap su "Entra" chiede anche il permesso del giroscopio su iOS)
3. Host sceglie la pista e preme **START** (servono almeno 2 piloti)
4. Intro con il nome della pista → 3‑2‑1 → gara di circa 1:30–2:00 (2 giri, 3 su Ristorante e Småland)
5. **Fine gara:** appena taglia il traguardo il **penultimo** pilota. L'ultimo non deve finire ed è ultimo. Con 2 giocatori finisce al primo arrivo.
6. Schermata risultati con ordine d'arrivo, tempi per giro e totale + podio animato sugli scaffali → **CONTINUA** torna al flusso del quiz

**Controlli telefono (meglio in orizzontale, funziona anche in verticale):** tieni premuto **GAS** in basso a destra (lasciarlo = frenare) · sterzo con **◀ ▶** in basso a sinistra (si può far scorrere il pollice) · **OGGETTO** accanto al GAS (dopo la roulette di ~1 s). In sala d'attesa si può passare allo sterzo a **inclinazione**.

**Sterzo assistito (attivabile in sala d'attesa, di default SÌ):** mentre tieni il GAS e non tocchi ◀ ▶, il kart segue la curva da solo; si sterza per sorpassare, prendere le scatole "?" o schivare.
**Tappeto:** ai lati della strada c'è qualche metro di tappeto dove si può andare ma si è più lenti; oltre ci sono i muri.
**Salti:** su ogni pista ci sono 3 rampe a tutta larghezza, messe in automatico sui rettilinei più dritti. In volo tocca lo schermo per un **TRICK** (giro di 360°): all'atterraggio prendi un boost.

I bordi della strada sono muri (pareti dello showroom, scaffali del magazzino, ringhiere del ristorante, cuscinoni di Småland, casse): non si esce di pista, si striscia contro. Le file di scatole "?" sono sparse lungo il giro come in Mario Kart; chi è indietro trova oggetti migliori.

**Sabotaggio:** chi arriva passa a una vista dall'alto della pista e tocca lo schermo per lanciare purè, cuscini o scatole sugli altri. Lanci: 1° = 4 … ultimo = 1.

## Piste

| Pista | Carattere | Evento firma |
|---|---|---|
| Showroom | tecnica, curve strette | scaffale che crolla |
| Magazzino Self-Service | veloce, rettilinei, corsie strette | muletto che attraversa |
| Ristorante | pavimento scivoloso, slalom tra i tavoli | gelato in volo (CATCH!) |
| Småland | caos, rampe, boost, ostacoli morbidi | carrello impazzito |
| Casse | mista, bivio corto‑stretto / lungo‑largo, traguardo "TACK!" | blackout |


## File

```
server.js          server: fisica autoritativa 60 Hz, power-up, eventi, sabotaggio, bot, hook quiz
public/tracks.js   dati e geometria delle piste (condiviso server + browser)
public/render.js   grafica: negozio 3D (three.js), kart, oggetti, eventi, particelle + icone 2D, minimappa
public/host.html   vista proiettore: lobby, negozio 3D dall'alto, risultati + podio
public/player.html vista telefono: join, visuale da dietro il kart, controlli, sabotaggio
package.json
```

## Integrazione con il quiz

In `server.js`, sezione **QUIZ INTEGRATION HOOKS**:

```js
const race = require('./server');           // non avvia nulla finché non chiami race.start()
race.hooks.getStartingGrid = (players) => players.sort((a, b) => quizScore(b) - quizScore(a));
race.hooks.applyWinnerBonus = (winner) => { /* TODO: bonus del quiz */ };
race.hooks.onRaceFinished = (results) => { /* [{playerId, rank, time, name, ...}] */ };
race.hooks.onContinue = (results) => { /* l'host ha premuto CONTINUA → torna al quiz */ };
race.start();
```

- `getStartingGrid(players)` → ordine di partenza (pole per primo). Ora è **casuale**.
- `applyWinnerBonus(winner)` → **TODO**, il tipo di bonus è ancora da decidere.
- Evento Socket.io **`race_finished`** → `{ trackId, results: [{ playerId, rank, time, name, color, lapTimes }] }` (`time` = `null` per chi non arriva).
- Evento **`quiz_continue`** emesso quando l'host preme CONTINUA.

## Eventi Socket.io

| Evento | Direzione | Payload |
|---|---|---|
| `join` | tel → server | `{code, name, color}` + ack `{ok, id}` |
| `start_race` | host → server | `{trackId}` |
| `input` | tel → server (~10 Hz) | `{gas, steer}` |
| `powerup_collected` | server → tutti | `{playerId, item}` |
| `powerup_used` | tel → server, poi server → tutti | `{playerId, item}` |
| `lap_completed` | server → tutti | `{playerId, lap, time}` |
| `race_finished` | server → tutti | vedi sopra |
| `sabotage_throw` | tel → server, poi server → tutti | `{type, x, y}` |
| `state` | server → tutti (~30 fps) | posizioni, oggetti, trappole, eventi |
| altri | | `lobby`, `race_countdown`, `race_go`, `fx`, `icecream`, `catch`, `blackout`, `sabotage_start`, `continue`, `quiz_continue`, `rejoin`, `demo_add` |

## Taratura

- Fisica auto (uguale per tutti): `CAR` in `server.js` (accelerazione, frenata, velocità massima, sterzo)
- Per pista: `speed`, `grip` (basso = più drift), larghezze, raggi delle curve in `public/tracks.js`
- Probabilità dei power-up: `weight` in `ITEMS` (somma 100, köttbullar d'oro 5%)
- Frequenza eventi: `spawnEvent` / `nextEventAt` in `server.js`

Le piste sono lunghe 7–11 km "di negozio" (unità di gioco): con i bot la gara dura ~70–100 s, con persone vere circa 1:30–2:00.
Non c'è musica né audio: l'atmosfera è tutta visiva (showroom con stanze arredate, corsie del magazzino, ristorante, Småland, casse).

> Progetto amatoriale/privato a tema: "IKEA" e i nomi dei prodotti sono marchi di Inter IKEA Systems B.V.
