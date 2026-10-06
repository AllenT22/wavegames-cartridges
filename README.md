# WaveGames Cartridges

Public source, tests, developer tools, and ready-to-import packages for the
WaveGames Cartridge API 1 collection.

## Included games

| Game | Players | Highlights | Import package |
| --- | ---: | --- | --- |
| Checkers | 2 | Mandatory captures, multi-jumps, kings, rematches | [`WaveGames-Checkers-1.0.0.wavegame`](releases/1.0.0/WaveGames-Checkers-1.0.0.wavegame) |
| Chess | 2 | Castling, en passant, promotion, standard draws | [`WaveGames-Chess-1.0.0.wavegame`](releases/1.0.0/WaveGames-Chess-1.0.0.wavegame) |
| Connect Four | 2 | Complete horizontal, vertical, and diagonal play | [`WaveGames-Connect-Four-1.0.0.wavegame`](releases/1.0.0/WaveGames-Connect-Four-1.0.0.wavegame) |
| Go | 2 | 19x19 board, captures, simple ko, Chinese-area scoring | [`WaveGames-Go-1.0.0.wavegame`](releases/1.0.0/WaveGames-Go-1.0.0.wavegame) |
| Color Match | 2-8 | Color/number matching, action cards, last-card declarations, scored rounds | [`WaveGames-Color-Match-1.0.0.wavegame`](releases/1.0.0/WaveGames-Color-Match-1.0.0.wavegame) |

Every game contains a deterministic authority rules module, player-filtered
views, a responsive HTML/JavaScript UI, an English/Japanese manifest, an icon,
and executable scenario tests covering public-state rules.

## Import and play

1. Download a `.wavegame` file from [`releases/1.0.0`](releases/1.0.0).
2. Copy it to Android Downloads or iOS Files.
3. In a WaveGames 0.3 cartridge-capable build, open **Library**, select
   **Import cartridge**, and choose the file.
4. Select **Play here**, or connect a WaveGames board and select **Nearby**.

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
releases/1.0.0/             deterministic import packages and checksums
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
