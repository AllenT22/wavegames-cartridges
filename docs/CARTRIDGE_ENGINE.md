# Cartridge API 1 contract

This reference describes the package/SDK contract in the public repository.
Phone-host behavior is documented for the separately maintained WaveGames
application. App version, game version, engine API, and runtime plugin version
are independent; a declaration in a manifest is not platform test evidence.

## Responsibilities

| Component | Owns |
| --- | --- |
| Rules module | Authoritative JSON state, legal actions, per-player views |
| Cartridge UI | Rendering, input, sending actions, connection/error feedback |
| Phone host | Authenticated actors, roster, deterministic RNG, revisions, transport, quotas, storage |
| MeshCore radio/repeaters | Carrying encrypted packets; no cartridge execution or package transfer |

Radio games have one authoritative host phone. Only filtered views leave that
host for other players. The public simulator provides a development authority
and isolated player views; it is not the full phone application.

## Manifest and package

A package is a ZIP containing wavegame.json, the declared rules/UI/icon paths,
all referenced local assets, and generated META-INF/files.json. The
[manifest schema](../tools/wavegame/schema/wavegame-manifest.schema.json) and
[Node validator](../tools/wavegame/src/manifest.mjs) define the public format.

Required fields are formatVersion, id, version, title, icon, engineApi,
entrypoints, orientation, capabilities, and modes. description is optional.
formatVersion and engineApi are both 1. Rules/UI entrypoints end in .mjs/.html.
At least one local or wave mode is required. Local supports 1–8 players; wave
supports 2–8 and requires pace: turn-based. orientation is any, portrait, or
landscape. Only audio and storage capabilities are accepted.

META-INF/files.json has shape {"files": [...], "formatVersion": 1}.
Each file record contains path, size, and sha256. It lists every payload file,
including wavegame.json, once in UTF-8 path order; it does not list itself.
The package digest is SHA-256 of the exact canonical index bytes. The canonical
index fixture is in [testdata](../tools/wavegame/testdata/).

A match requires identical package ID, engine API, and content digest. Version
labels alone are not sufficient. ZIP metadata/compression changes need not
change content identity; a payload edit does. The complete archive SHA-256 in
a release checksum file is a different hash from the cartridge package digest.

The app stages an imported file, validates its structure/index/hashes, then
installs it into private storage. API 1 public files have no verified publisher
signature and are shown as Unverified. A digest is not publisher identity.

## Limits

Values come from [toolkit constants](../tools/wavegame/src/constants.mjs).
MiB/KiB below are binary units; runtime limits measure encoded JSON bytes.

| Item | Limit |
| --- | ---: |
| ZIP archive | 25 MiB |
| Expanded archive | 75 MiB |
| Files | 1,000 |
| Expanded single file | 20 MiB |
| Compression expansion ratio | 100:1 |
| Path | 255 bytes, relative portable ASCII |
| Authoritative state | 64 KiB |
| Action | 512 bytes |
| Player view | 2 KiB |
| One presentation event | 512 bytes |
| Scoped native storage | 1 MiB |

The reader rejects unsafe paths, symlinks, file/directory and case collisions,
duplicate entries, unsupported ZIP metadata/compression, encrypted/split/ZIP64
archives, CRC errors, overlapping/hidden data, unindexed files, and hash or size
mismatches. Validation is structural; it does not prove safe or correct gameplay.

## Rules contract

```js
export function create({ seed, players, options, random }) {}
export function reduce({ state, playerId, action, revision, requestId, random }) {}
export function view({ state, viewer, players, revision }) {}
```

create returns state. reduce returns {accepted: true, state, events?} or
{accepted: false, reason?}. The host increments revision after an accepted
transition, not after a rejected action. Actor identity comes from the approved
session, not a field in action. view returns only the requested player's data.

create/reduce share the host's seeded RNG stream via nextFloat/nextInt.
Rejected actions must not advance committed RNG state. view receives no random
stream. Rules must use finite JSON and must not depend on clocks, ambient
entropy, UI state, network, browser storage, or device services.

API 1 invokes create/reduce/view, not an optional timeout reducer. General
presentation events are delivered in the simulator/local hosts. Radio play
sends filtered views, so derive radio presentation cues from those views.
A game's hidden information must never enter another player's view or a public
event. [Developer guidance](DEVELOPING.md) covers SDK and testing patterns.

## Phone multiplayer behavior

The current app starts games from the main game lobby; Game Library imports
and manages packages. It does not expose the earlier Play here / Nearby flow.
The host selects the game and, where applicable, a manifest-bounded room size,
then approves guests. Play starts after selected seats complete authenticated
confirmation. The roster is fixed after start: no spectators or late joins.

Each guest has a separate encrypted host session. The host serializes accepted
actions, deduplicates request IDs, and generates a view for each player. Game
files never travel through the radio. A player departure or expired liveness
timeout ends the match; there is no host migration or persisted online resume.
Transient loss may recover before timeout. Timing is selected by the radio
transport, not fixed universally at the prototype's 6/45-second thresholds;
see [protocol notes](PROTOCOL.md).

## Native runtime snapshot

The included plugin supplies document picking and separate visible/rules
WebViews on Android/iOS. In this public snapshot both platforms use a local
wavegame://cartridge/ origin. An embedding host still must implement package
installation, roster, sessions, revision/RNG state, storage quotas, delivery,
and action/storage replies. This plugin alone is not a multiplayer app.

The sandbox blocks external resources and native device permissions and uses
bounded typed bridge messages. Its 250 ms native watchdog is best-effort, not
a guaranteed hard CPU interrupt; the Dart fail-safe is 500 ms. A timed-out or
destroyed rules runtime cannot be reused or commit an unconfirmed transition.
See the [runtime README](../runtime/wavegame_runtime/README.md) and
[security contract](../runtime/wavegame_runtime/SECURITY_CONTRACT.md) for precise
snapshot behavior and platform-specific caveats.
