# Develop a WaveGames cartridge

A cartridge contains JavaScript rules, an HTML/CSS/JavaScript interface, and its
assets. You do not need to change the phone app, radio firmware, or radio
protocol to make an API 1 game. This repository provides the examples, Node
CLI, browser simulator, and a native runtime source snapshot. It does not
contain the complete phone application or a ready-to-run Flutter app.

## Start from a working example

Install Node.js 24 or newer, clone this repository, and run commands from its root.
No npm install is needed for the toolkit.

```sh
git clone https://github.com/AllenT22/wavegames-cartridges.git
cd wavegames-cartridges
node tools/wavegame/bin/wavegame.mjs test cartridges/connect-four
node tools/wavegame/bin/wavegame.mjs dev cartridges/connect-four --port 8030
```

Open the printed localhost URL. Ctrl-C stops the simulator. If the port is in
use, choose another or omit --port to let the operating system select one.
The simulator serves one authoritative rules worker and separate player
iframes. Its seat selector uses the manifest's local range when present,
otherwise its wave range. It can inject delay, drop/duplicate the next bridge
message, reorder the next pair, reconnect a seat, and copy a replay.

These are simulated bridge conditions, not measurements of MeshCore, LoRa,
Bluetooth, or native WebView behavior. There is no live reload. Restart the simulator after source or manifest edits
so the rules worker, validated manifest, and displayed package digest are refreshed.

## Create your own game

```sh
node tools/wavegame/bin/wavegame.mjs create my-game --id games.example.my-game --title "My Game"
node tools/wavegame/bin/wavegame.mjs validate my-game
node tools/wavegame/bin/wavegame.mjs test my-game
node tools/wavegame/bin/wavegame.mjs dev my-game
```

`create` requires an empty or missing directory. It writes a turn-demo scaffold:

```text
my-game/
  wavegame.json
  rules/index.mjs
  ui/index.html
  ui/game.mjs
  ui/styles.css
  ui/wavegames-sdk.mjs
  assets/icon.svg
  tests/scenarios.mjs
```

Replace the demo rules with your game's rules. Validate all actions in the
rules module, including turn, membership, range, and game phase. Do not trust
client-supplied fields such as player count or identity just because the
starter sends them. Store authoritative values from create's players/options
in state when the reducer needs them.

## Manifest

Use [the schema](../tools/wavegame/schema/wavegame-manifest.schema.json) and
[the validator](../tools/wavegame/src/manifest.mjs). This is a valid two-player
starting manifest; referenced files must exist:

```json
{
  "formatVersion": 1,
  "engineApi": 1,
  "id": "games.example.my-game",
  "version": "0.1.0",
  "title": { "en": "My Game" },
  "description": { "en": "A turn-based game." },
  "icon": "assets/icon.svg",
  "entrypoints": { "rules": "rules/index.mjs", "ui": "ui/index.html" },
  "orientation": "any",
  "capabilities": [],
  "modes": {
    "local": { "minPlayers": 2, "maxPlayers": 2 },
    "wave": { "minPlayers": 2, "maxPlayers": 2, "pace": "turn-based" }
  }
}
```

IDs are lowercase reverse-domain names, at least three segments, at most 48
characters. Use your own namespace. Versions are semantic version strings.
Unknown fields are rejected. Titles/descriptions are locale maps, with up to
16 entries and 80/240 characters per value. Paths are relative portable ASCII;
case collisions, parent traversal, symlinks, and absolute paths are rejected.

Only audio and storage capabilities are recognized. Declare only what you use.
A local manifest mode permits local hosts/simulation; it does not make a
Play here button appear in the current phone app. Radio play needs a wave mode
with 2–8 players and turn-based pace. See [the API contract](CARTRIDGE_ENGINE.md)
for the full package and runtime limits.

## Rules, randomness, and private information

The rules entrypoint exports create, reduce, and view:

```js
export function create({ seed, players, options, random }) { /* return JSON state */ }
export function reduce({ state, playerId, action, revision, requestId, random }) {
  // Return { accepted: true, state, events? }
  // or     { accepted: false, reason: 'Explain the rejection' }
}
export function view({ state, viewer, players, revision }) { /* return JSON view */ }
```

The host supplies the actor through playerId. An actor named inside action is
not authorization. Treat state as authoritative, return the next state only
for accepted actions, and keep outputs within the byte limits. Player records
contain id, seat, and name; use the supplied IDs rather than deriving identity
from a display name or assuming every host uses a particular ID spelling.

Use only random.nextFloat() and random.nextInt(maxExclusive) for game randomness
in create/reduce. The host owns the seed and draw counter. Do not use
Math.random, crypto entropy, wall/performance clocks, timers, DOM access, or
browser storage in rules. A view must be deterministic and must not consume
randomness. State/actions/views must be finite JSON, not functions, undefined,
BigInt, cyclic values, native handles, or NaN/Infinity.

Return only the requested viewer's information from view. Never send the full
state, hidden hands, future draws, unrevealed positions, or private seeds to the
UI and hide them with CSS. Presentation events are broadcast in the simulator;
radio API 1 distributes filtered views rather than a general event stream.
Keep events public and derive radio animations/audio from successive views.

## UI and the bundled SDK

Load the client from the package itself, not a CDN:

```js
import { WaveGames } from './wavegames-sdk.mjs';
const game = await WaveGames.connect({ api: 1 });
```

Read context.playerId/context.seat and subscribe to onView, onRoster, and
onStatus. Render an already available game.view as well as subsequent views;
the first view can arrive before a listener is installed. A listener returns
an unsubscribe function. Release subscriptions and call game.close() when the
UI session is disposed.

sendAction(action) returns a Promise. A response with accepted: false is a
rules rejection; display its reason. Connection/timeout failures reject the
Promise and need a catch path. Disable repeat submissions while a move is
pending and disable move controls during connecting/recovering/disconnected
or ended states. Render from the host's confirmed view, not an assumed result.

The client defaults to 10 seconds for connection and 30 seconds for action or
storage requests. connect({api: 1, timeoutMs, requestTimeoutMs}) accepts positive
integer deadlines up to 300,000 ms. A timed-out action is never automatically
resent: it may already have been accepted. Inspect the current turn and view
before offering a retry. A bridge request timeout is distinct from the radio
connection timeout described in [protocol notes](PROTOCOL.md).

storage.get/set/remove use app-mediated storage. Declare storage capability;
use short keys containing letters, digits, dots, underscores, or hyphens
(up to 80 characters). Native storage is scoped by package ID/digest with a
1 MiB quota. Simulator storage is in-memory per seat and survives that seat's
reconnect, not a fresh simulation run. Do not use localStorage as a substitute.

The SDK adapts to the simulator MessagePort handshake or the native-injected
window.WaveGames runtime. Never overwrite that global or wire private native
bridge handlers directly. Bundle CSS, images, fonts, audio, and scripts in the
package and use relative paths. The native sandbox blocks external networking
and browser/native permissions. The visible document needs a valid head and
strict UTF-8; this runtime snapshot limits entry HTML to 2 MiB. See the
[runtime contract](../runtime/wavegame_runtime/SECURITY_CONTRACT.md).

## Test, package, and share

```sh
node tools/wavegame/bin/wavegame.mjs test my-game
node tools/wavegame/bin/wavegame.mjs pack my-game my-game.wavegame
node tools/wavegame/bin/wavegame.mjs validate my-game.wavegame
node tools/wavegame/bin/wavegame.mjs inspect my-game.wavegame
```

pack does not run gameplay tests for you; run test first. It generates the file
index and writes a deterministic ZIP. Existing outputs are not overwritten.
Remove/move your own old output or choose a new filename before repacking.

Tests/scenarios execute JavaScript from a trusted source directory in Node,
with the developer account's access. The determinism guard is not an OS
sandbox. The test command rejects downloaded archives; validate and inspect
read their structure without executing rules. The simulator can also open an
archive, executing its rules/UI in the browser; review content before running it.

A tests/scenarios.mjs file exports scenarios records with name, players,
optional seed, and run({host, players, assert}). Use dispatchAction(seat, action),
viewForSeat(seat), and stateSnapshot() for assertions. Add legal and illegal
moves, turn enforcement, wins/draws/rematches, privacy for every seat, and all
supported roster sizes. Optional conformanceActions({players, state}) exports
up to 256 {seat, action} records; the test runner replays them twice and compares
results/state. Passing these checks is not a proof of complete game rules.

Increment the game version for changed distributed content and share the exact
same file with all players. A UI-only edit also changes the package digest.
Never replace an already published versioned file. Full distribution checks,
release archives, and physical acceptance are documented in [validation](VALIDATION.md)
and [contributing](../CONTRIBUTING.md).
