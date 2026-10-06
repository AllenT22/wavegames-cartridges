# WaveGames Cartridges

Public source, tests, developer tools, and ready-to-import packages for the
WaveGames Cartridge API 1 collection.

## Included games

| Game | Players | Highlights | Import package |
| --- | ---: | --- | --- |
| Checkers | 2 | Mandatory captures, multi-jumps, kings, rematches | [`WaveGames-Checkers-1.1.0.wavegame`](releases/1.1.0/WaveGames-Checkers-1.1.0.wavegame) |
| Chess | 2 | Castling, en passant, promotion, standard draws | [`WaveGames-Chess-1.1.0.wavegame`](releases/1.1.0/WaveGames-Chess-1.1.0.wavegame) |
| Connect Four | 2 | Complete horizontal, vertical, and diagonal play | [`WaveGames-Connect-Four-1.1.0.wavegame`](releases/1.1.0/WaveGames-Connect-Four-1.1.0.wavegame) |
| Go | 2 | 19x19 board, captures, simple ko, Chinese-area scoring | [`WaveGames-Go-1.1.0.wavegame`](releases/1.1.0/WaveGames-Go-1.1.0.wavegame) |
| Color Match | 2-8 | Color/number matching, action cards, last-card declarations, scored rounds | [`WaveGames-Color-Match-1.1.0.wavegame`](releases/1.1.0/WaveGames-Color-Match-1.1.0.wavegame) |

Every game contains a deterministic authority rules module, player-filtered
views, a responsive HTML/JavaScript UI, an English/Japanese manifest, an icon,
and executable scenario tests covering public-state rules.

## Import and play

1. Download a `.wavegame` file from [`releases/1.1.0`](releases/1.1.0).
2. Save it to Downloads or Files.
3. In a cartridge-capable WaveGames build, open **Library**, select
   **Import cartridge**, and choose the file. Some builds label this
   **Game Library / Import game**.
4. Return to **Game Lobby**. The host selects the game and approves the players.
   For radio play, connect each phone to its own compatible radio first.

Nearby players must import the exact same package. WaveGames compares the
package digest; cartridge files are not transferred through the board mesh.

## Develop and verify

The toolkit is dependency-free and requires Node.js 24 or newer.

```text
node tools/wavegame/bin/wavegame.mjs test cartridges/chess
node tools/wavegame/bin/wavegame.mjs dev cartridges/chess
node tools/wavegame/bin/wavegame.mjs pack cartridges/chess chess.wavegame
node --test tools/wavegame/tests/*.test.mjs
```

Rebuild the complete deterministic release:

```text
node tools/wavegame/bin/build-first-party.mjs artifacts/cartridge-release
```

See [`tools/wavegame/README.md`](tools/wavegame/README.md) for the CLI and SDK,
[`docs/CARTRIDGE_ENGINE.md`](docs/CARTRIDGE_ENGINE.md) for API 1 architecture,
and [`runtime/wavegame_runtime/SECURITY_CONTRACT.md`](runtime/wavegame_runtime/SECURITY_CONTRACT.md)
for the Android/iOS sandbox contract.

## Repository layout

```text
cartridges/                 complete game source and scenarios
docs/                       engine, protocol, and validation contracts
releases/1.1.0/             current import packages and checksums
releases/1.0.0/             retained previous downloads
runtime/wavegame_runtime/   Flutter, Android, and iOS sandbox runtime
tools/wavegame/             validator, packer, SDK, tests, and simulator
```

## Trust and acceptance boundary

These API 1 packages are public but unsigned. WaveGames correctly labels them
**Unverified** and validates their structure, file hashes, limits, and exact
content digest before installation. Public visibility is not a publisher
signature.

Automated rules, determinism, privacy, archive, and toolkit tests pass. Real
Files/Downloads import, platform WebView behavior, Bluetooth recovery, board
routing, and multi-phone play remain physical acceptance tasks for each target
device/OS combination.

## Version 1.1.0

All five games share graphite and amber controls, visible keyboard focus, and
connection/error handling. Chess retains draw offers until the opponent responds
or moves; Checkers resets its automatic no-progress draw clock when a man moves
or a capture occurs. Go offers exact coordinate selection and explicit placement
on small screens. Color Match retains its original geometric artwork.

The bundled SDK bounds host requests without automatically retrying a move. If
an acknowledgement is lost, inspect the current turn before retrying. Every
player in a match must import the same version. The prior 1.0.0 downloads remain
available unchanged.
