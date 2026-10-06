# WaveGames Cartridge API 1 test bundle

These public packages use Cartridge API 1 and are ready for testing with a
cartridge-capable WaveGames build. The **Unverified** label in the app is expected: API 1 validates
package contents and exact digests but does not claim publisher signatures.

## Import and play

1. Save one or more `.wavegame` files to Downloads or Files on your device.
2. In WaveGames, open **Library**, choose **Import cartridge**, and select a file.
   Some builds label this **Game Library / Import game**.
3. Return to **Game Lobby**. The host selects the game and approves the players.
   Join with the exact same package installed; packages are not sent through the mesh.
4. For radio play, connect each phone to its own compatible radio first.
5. Compare the package digest shown by the app with the digest below if a phone
   reports a mismatch.

| Game | Players | Import file | Cartridge package digest |
| --- | ---: | --- | --- |
| Connect Four | 2 | `WaveGames-Connect-Four-1.1.0.wavegame` | `29faec83dcba89b7c1b76fc1fee9927f70e2866017e1bf8729c2fbd87a742f6d` |
| Checkers | 2 | `WaveGames-Checkers-1.1.0.wavegame` | `5127850fc567603193917997ff377d09cbb17b8e09b0efe944426f66bc55a29a` |
| Chess | 2 | `WaveGames-Chess-1.1.0.wavegame` | `e9d7a1633985593b31b01160c652624de28b7644edf05e1f84fe0933fce13c0d` |
| Go | 2 | `WaveGames-Go-1.1.0.wavegame` | `0a10d29e098fa4c2fe023d52384faa9a36d46e466359a158f09a2cf3c8cdaf72` |
| Color Match | 2-8 | `WaveGames-Color-Match-1.1.0.wavegame` | `3dde4d7c89d0eb5750e24e8e6117b2b77d9d6854f30985f616e62809c3ee95d3` |

`SHA256SUMS-ALL.txt` verifies the copied release files. `WaveGames-Cartridge-Example-Sources-1.1.0.zip`
contains every cartridge source file plus the dependency-free API 1 toolkit,
tests, packer, and simulator used to reproduce the packages.

## Acceptance boundary

Automated rules, determinism, privacy, package, and archive validation have been
run before this bundle is emitted. Real Files/Downloads import, system WebView
sandbox behavior, BLE recovery, board routing, and multi-phone play still need
to be exercised on the intended phones and boards before public release.
