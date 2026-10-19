# WaveGames

Play turn-based games with friends over LoRa radio.

This repository contains the five public game cartridges, their source and tests,
and the tools for making your own games. A cartridge is a `.wavegame` file that
players import into the WaveGames app. The complete phone application and its
radio transport are maintained separately; this repository is not an app build.

[Website](https://wavegames.tiethoffserver.com/) ·
[Game downloads](https://wavegames.tiethoffserver.com/catalog.html) ·
[Developer guide](docs/DEVELOPING.md)

## Get the app

[Download WaveGames for Android (.apk)](https://github.com/AllenT22/wavegames-cartridges/releases/download/android-v0.4.0-build35/WaveGames-0.4.0-android.apk)

The current published Android test build is **0.4.0, build 35**, for Android 12
or newer. Its [release page](https://github.com/AllenT22/wavegames-cartridges/releases/tag/android-v0.4.0-build35)
includes a SHA-256 checksum. iPhone access is currently limited. Radio and
multi-phone testing is still in progress; the download is not a claim of
compatibility with every phone or radio.

## Games

| Game | Players | Description | Download |
| --- | ---: | --- | --- |
| Connect Four | 2 | Drop discs and connect four in a row. | [v1.1.0](releases/1.1.0/WaveGames-Connect-Four-1.1.0.wavegame) |
| Checkers | 2 | Jump opposing pieces and reach the far side to make kings. | [v1.1.0](releases/1.1.0/WaveGames-Checkers-1.1.0.wavegame) |
| Chess | 2 | Plan your moves and checkmate your opponent. | [v1.1.0](releases/1.1.0/WaveGames-Chess-1.1.0.wavegame) |
| Go | 2 | Place stones to surround territory and capture opposing groups. | [v1.1.0](releases/1.1.0/WaveGames-Go-1.1.0.wavegame) |
| Color Match | 2–8 | Match cards by color or numbers. | [v1.1.0](releases/1.1.0/WaveGames-Color-Match-1.1.0.wavegame) |

Choose the individual game file for phone import. The
[examples ZIP](releases/1.1.0/WaveGames-Cartridge-Examples-1.1.0.zip) groups the
packages and testing notes; the
[source ZIP](releases/1.1.0/WaveGames-Cartridge-Example-Sources-1.1.0.zip) contains
the game sources and toolkit. Extract ZIPs before selecting a `.wavegame` file.

## How it works

WaveGames sends game data over a private MeshCore channel, protected by the
channel's shared key. Game sessions add their own encryption and message
authentication between the host and each player. Compatible MeshCore repeaters
can relay the encrypted traffic without the channel key, when their settings
and routes allow. The host phone runs the rules; each player receives their own
view of the game.

## Setup

Each player needs the app, a compatible MeshCore Companion radio, and the same
game file.

1. **Install the application.** Download the Android APK above and open it on
   your phone. iPhone access is currently limited.
2. **Connect to your radio.** In the MeshCore app, set up the same private
   channel named **WaveGames** on every player's radio, using the same channel
   key and matching radio settings. Disconnect the MeshCore app, then open
   WaveGames and connect to your radio.
3. **Add a game.** Save a `.wavegame` file to Downloads or Files. Open
   **Game Library → Import game** in WaveGames and choose the file. Every
   player must import the exact same file.
4. **Host a game.** One player chooses the game and hosts a lobby. Others find
   the lobby and request to join. The host approves the players before play begins.

Use an appropriate antenna and settings permitted in your region. See
[setup and troubleshooting](docs/PLAYING.md) for channel requirements, app
handoff, package mismatches, and the Unverified label.

## Make a game

Use **Node.js 24 or newer**. The toolkit needs no npm dependencies.
From the repository root:

```sh
node tools/wavegame/bin/wavegame.mjs create my-game --id games.example.my-game --title "My Game"
node tools/wavegame/bin/wavegame.mjs test my-game
node tools/wavegame/bin/wavegame.mjs dev my-game
```

Open the simulator URL printed by `dev`; stop it with Ctrl-C. Then package and
check your game:

```sh
node tools/wavegame/bin/wavegame.mjs pack my-game my-game.wavegame
node tools/wavegame/bin/wavegame.mjs inspect my-game.wavegame
```

The [developer guide](docs/DEVELOPING.md) covers manifest fields, deterministic
rules, private views, the UI SDK, testing, and release handling. The generated
starter is a turn-demo scaffold, not a finished game.

## Documentation

| Reference | Contents |
| --- | --- |
| [Playing and setup](docs/PLAYING.md) | Android download, radio channels, import, lobby, troubleshooting |
| [Developer guide](docs/DEVELOPING.md) | Create, simulate, test, pack, distribute, and handle failures |
| [API 1 contract](docs/CARTRIDGE_ENGINE.md) | Manifest, package identity, byte limits, rules and multiplayer boundaries |
| [Radio and protocol notes](docs/PROTOCOL.md) | MeshCore forwarding, encryption limits, timing, host responsibilities |
| [Toolkit reference](tools/wavegame/README.md) | CLI commands, bundled SDK, archive validation |
| [Native runtime integration](runtime/wavegame_runtime/README.md) | Flutter plugin APIs and responsibilities of an embedding host |
| [Runtime security contract](runtime/wavegame_runtime/SECURITY_CONTRACT.md) | Sandbox, permissions, bridge, watchdog limitations |
| [Validation](docs/VALIDATION.md) | Reproducible checks and physical testing still required |
| [Contributing](CONTRIBUTING.md) | Changes, bug reports, sensitive information, licensing |
| [Provenance](docs/PROVENANCE.md) | Public source and release history |

## Versions and trust

The app version (**0.4.0 / build 35**), game release (**1.1.0**), Cartridge API
(**1**), and runtime plugin (**0.1.0**) are different version numbers. The
bundled native runtime is a source snapshot, not proof of which plugin revision
is embedded in the downloadable APK.

These game files are not publisher-signed, so WaveGames labels them
**Unverified**. File hashes detect changed content; they do not prove who
published it. Matching package versions alone is insufficient: the content
digest must match too. Published [1.0.0](releases/1.0.0/) and
[1.1.0](releases/1.1.0/) downloads remain unchanged.

The runtime has its own [Apache-2.0 license notice](runtime/wavegame_runtime/LICENSE).
There is currently no repository-wide license file; confirm the terms for
other components with the maintainer before redistributing them.
