# WaveGames Cartridge Engine

Status: public API 1 implementation contract for WaveGames 0.3.0.

WaveGames cartridges are portable, interpreted game packages. A player can
select a `.wavegame` file in Android Downloads or iOS Files, install it into
private app storage, and play it without rebuilding the app or firmware.

The stable Tic-Tac-Toe and Battleships implementations remain compiled into
the app and firmware. Their game IDs, payloads, hosting modes, and existing
wire vectors do not change.

## Architecture

Cartridge games use three deliberately separate layers:

1. The rules module owns serializable authoritative game state. It accepts an
   action attributed by the WaveGames host and returns either a new state or a
   rejection. It never receives BLE identities or encryption keys.
2. The UI document renders a player-filtered view and emits explicit actions.
   It cannot read authoritative state directly.
3. The WaveGames host owns players, seats, randomness, revisions, request
   deduplication, storage quotas, connectivity, encryption, and delivery.

For local play all three layers are on one phone. For Wave play the host phone
runs the one authoritative rules module and each phone renders only its own
view. Boards continue to route opaque authenticated WaveWire frames; they do
not download or execute cartridges.

## Package layout

A `.wavegame` file is a deterministic ZIP archive with this minimum layout:

```text
wavegame.json
META-INF/files.json
rules/index.mjs
ui/index.html
ui/app.mjs
ui/style.css
assets/icon.svg
```

`wavegame.json` is a strict Cartridge API 1 manifest. It contains:

- a lowercase reverse-domain package ID and semantic package version;
- localized title and optional description;
- `engineApi: 1` and `formatVersion: 1`;
- rules, UI, and icon entrypoints;
- supported orientation and declared `audio` or `storage` capabilities;
- local and/or Wave player limits, from 1–8 locally and 2–8 on Wave;
- `pace: "turn-based"` for every Wave mode.

`META-INF/files.json` lists every other regular file exactly once, sorted by
its UTF-8 path, with its byte length and SHA-256 digest. Its exact API 1 shape
is `{ "files": [...], "formatVersion": 1 }`; it does not contain its own
digest. The package identity is the SHA-256 digest of the canonical file index.
ZIP order, timestamps, and compression do not affect compatibility.
Package paths use portable ASCII segments so Unicode normalization, case, and
parent-file aliases cannot select different content on Android and Apple filesystems.

Players in one lobby must have the same package ID, engine API, and exact
package digest. Packages are never transferred over BLE or the Wave mesh.

## Installation and trust

Import is an explicit user action through the system document picker. The app
copies the selected file into private staging, validates it, and only then
atomically moves it into content-addressed private storage. It never executes
from Downloads or Files and never asks for broad storage access.

API 1 accepts structurally valid local packages. They are visibly
labelled **Unverified**. Publisher signatures and a curated distribution
catalog are intentionally deferred; no unsigned package may be presented as
publisher-verified.

Validation limits are:

| Limit | API 1 value |
| --- | ---: |
| Compressed package | 25 MiB |
| Expanded package | 75 MiB |
| Regular files | 1,000 |
| One expanded file | 20 MiB |
| Path bytes | 255 |

The validator rejects encrypted, split, ZIP64, symlink, absolute, drive-letter,
backslash, dot-segment, duplicate, case-colliding, prefix-colliding,
overlapping, CRC-mismatched, undeclared, and unsupported-compression entries.
Limits are checked from metadata before expansion and again while reading.

## Sandbox and capabilities

Android uses a hardened system WebView with a `wavegame://` resource handler.
iOS uses `WKURLSchemeHandler` and a nonpersistent `WKWebsiteDataStore`. Both
platforms serve only files rooted in the installed package directory.

The runtime blocks external networking, ordinary file/content/data URLs,
navigation outside the cartridge, popups, downloads, file choosers, camera,
microphone, location, media capture, and native platform permissions. It does
not expose raw BLE, station IDs, filesystem paths, device identifiers, session
keys, clipboard, or arbitrary native methods.

Every JavaScript bridge instance has a random channel token. Messages are
typed, bounded, and validated on both sides. App-mediated storage is namespaced
by package ID and digest and limited to 1 MiB. A rules call has a 250 ms native
watchdog plus host-side fail-safe; timeout or renderer failure destroys that
rules runtime and ends or rejects the operation safely.

Runtime data limits are:

| Value | API 1 maximum |
| --- | ---: |
| Authoritative state | 64 KiB canonical JSON |
| Player action | 512 bytes canonical JSON |
| Filtered player view | 2 KiB canonical JSON |
| Rules event | 512 bytes canonical JSON |

## Rules API

The rules entrypoint exports:

```js
export function create({ seed, players, options, random }) {}
export function reduce({ state, playerId, action, revision, requestId, random }) {}
export function view({ state, viewer, players, revision }) {}
```

`reduce` returns either `{ accepted: true, state, events? }` or
`{ accepted: false, reason? }`. WaveGames increments the revision once
after an accepted action and never after a rejection. `playerId` is derived
from the authenticated seat; an action payload cannot select or override it.

API 1 does not call an optional timeout reducer. A player leaving or reaching
the 45-second timeout ends a nearby match. This keeps the fixed roster and RNG
transaction contract unambiguous; a cartridge-specific timeout transition is
reserved for a later engine API.

`events` are bounded presentation hints for local play. Nearby play distributes
only viewer-filtered views in API 1 because a single reducer event has no
per-viewer privacy contract. Nearby UI should derive animation and audio cues
from successive filtered views.

Randomness is supplied by the host through a deterministic, replayable random
source. Rules and saved state must be finite JSON. UI objects, DOM nodes,
functions, clocks, sockets, and native handles are not valid state.

The UI connects with the bundled SDK, listens for session/roster/view/status
messages, and sends actions. Rendering code never imports the rules module.

## Multiplayer contract

Cartridge Wave play is phone-authority only in API 1:

- 2–8 fixed seats; no spectators or late joins;
- the host manually approves guests and explicitly starts after the minimum
  player count is present;
- the roster is immutable after start and disconnected seats remain reserved;
- pairwise P-256/AES-GCM sessions are used for each guest, never a group key;
- the host serializes mutations, deduplicates requests, increments revisions,
  and produces one filtered view per seat;
- acknowledgements pace one application fragment in flight per peer;
- at most six reliable application envelopes are pending globally;
- the host emits a 2-second heartbeat, treats 6 seconds as recovering, and
  ends the fixed-roster match at 45 seconds;
- host loss ends the match; API 1 has no host migration or persisted online
  resume.

All authenticated WaveWire messages, including heartbeat, leave, and error,
use the outer mesh `session` packet type. Wire game ID `0` is the explicit
cartridge discriminator. Lobby negotiation carries package identity and API
compatibility; ordinary gameplay traffic is authenticated.

The mobile Library exposes separate **Play here** and **Nearby** actions when a
manifest supports both modes. Nearby play reuses an already connected board,
then constructs the cartridge-only host or guest gateway without widening the
compiled-game controller or enum. The host sees queued approval cards, selects
the manifest-bounded capacity, and explicitly starts; guests can see mismatched
lobbies but cannot join them.

## Developer workflow

The repository includes a dependency-free Node 24 tool:

```text
wavegame create <directory>
wavegame validate <directory-or-wavegame>
wavegame pack <directory> [output.wavegame]
wavegame inspect <package.wavegame>
wavegame test <trusted-source-directory>
wavegame dev <directory>
```

The local simulator runs one authoritative rules Web Worker and 2–8 isolated player
views using the same bridge envelopes as mobile. It can reset a match, copy a
replay, disconnect/reconnect a seat, and inject delay, loss, duplication, and
reordering. `test` verifies exports, deterministic replay, filtered views,
limits, manifest/index integrity, and cartridge tests before packaging.

## Compatibility and release gates

The following are release invariants:

- existing Tic-Tac-Toe and Battleships byte vectors remain unchanged;
- existing board-host and phone-host flows remain available;
- firmware forwarding of wire game ID 0 is covered by host tests;
- native, sanitizer, mobile, bench, endpoint, and relay builds remain green;
- malformed-package and sandbox escape tests pass on both Android and iOS;
- Connect Four freezes API 1, UNO proves hidden information and 8 seats,
  Checkers and Chess prove complex-turn and full-rules parity, and Go proves a
  full 19-by-19 public board with deterministic area scoring;
- compiled provisional versions of converted games are removed only after
  golden action-log and filtered-view parity passes.

Automated tests are software evidence only. Downloads/Files import, sandbox
behavior, multi-phone recovery, and 2–8 player operation still require the
documented physical acceptance matrix before a public release claim.
