# WaveGames Cartridge API 1 test bundle

These public packages are ready for testing with the WaveGames 0.3 cartridge
engine. The **Unverified** label in the app is expected: API 1 validates
package contents and exact digests but does not claim publisher signatures.

## Import and play

1. Copy one or more `.wavegame` files to Android Downloads or iOS Files.
2. In WaveGames, open **Library**, choose **Import cartridge**, and select a file.
3. Use **Play here** for a local two-seat test, or connect a board and choose
   **Nearby** for a multi-phone match.
4. For Nearby play, import the exact same file on every phone. The host approves
   the fixed roster and starts the match; packages are not sent through the mesh.
5. Compare the package digest shown by the app with the digest below if a phone
   reports a mismatch.

| Game | Players | Import file | Cartridge package digest |
| --- | ---: | --- | --- |
| Connect Four | 2 | `WaveGames-Connect-Four-1.0.0.wavegame` | `71cb38139c6469fc6dc5d5b65e968b555460732bfc52e15285fcb8f7aa9e1dc6` |
| Checkers | 2 | `WaveGames-Checkers-1.0.0.wavegame` | `529ae12ff320ce62c8e06a14ba223fb8d3c307a7cfab94c2a7b2bb99160fa6d1` |
| Chess | 2 | `WaveGames-Chess-1.0.0.wavegame` | `86a545b57bdb8e76b7b9c61266b6b1c56855e1d507867cf986c20acee361ab50` |
| Go | 2 | `WaveGames-Go-1.0.0.wavegame` | `b47c4779fb0110aba8daf9506ae66fa10ed865b8703de59d5e3c91b20fb67295` |
| UNO | 2-8 | `WaveGames-UNO-1.0.0.wavegame` | `407e422ac031141d3b0f6ab5d3bf1ca4b73974b8c27a6df9dc3f62346f445ae8` |

`SHA256SUMS-ALL.txt` verifies the copied release files. `WaveGames-Cartridge-Example-Sources-1.0.0.zip`
contains every cartridge source file plus the dependency-free API 1 toolkit,
tests, packer, and simulator used to reproduce the packages.

## Acceptance boundary

Automated rules, determinism, privacy, package, and archive validation have been
run before this bundle is emitted. Real Files/Downloads import, system WebView
sandbox behavior, BLE recovery, board routing, and multi-phone play still need
to be exercised on the intended phones and boards before public release.
