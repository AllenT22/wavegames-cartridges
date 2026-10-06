# Validation status

## Public repository checks

Run the dependency-free toolkit and all cartridge scenarios with Node.js 24 or
newer:

```text
node --test tools/wavegame/tests/*.test.mjs
node scripts/check-distribution.mjs
node tools/wavegame/bin/build-first-party.mjs artifacts/cartridge-release
```

The toolkit suite contains 21 checks covering the CLI, simulator, deterministic
rules guard, strict manifest/JSON/path validation, canonical cross-language
digests, ZIP safety, package indexing, authority/view separation, deterministic
randomness, the UI bridge, and native-runtime handoff.

The first-party release command runs authority, determinism,
state/view-limit, privacy, and playable-scenario checks across Connect Four,
Checkers, Chess, Go, and Color Match. It packs each source directory, validates the
resulting archive again, and records both the Cartridge API package digest and
the complete-file SHA-256.

Verify a release directory from inside that directory:

```text
shasum -a 256 -c SHA256SUMS-ALL.txt
```

Two builds from the same source must produce identical `RELEASE.json`, package
digests, and `SHA256SUMS-ALL.txt`.

## Native runtime checks

The standalone Flutter plugin is checked with:

```text
cd runtime/wavegame_runtime
flutter analyze
flutter test
```

The Dart tests cover trusted support-directory selection, typed and correlated
bridge messages, deterministic random-counter propagation, terminal timeout
behavior, and outstanding-request limits. Android unit tests additionally live
beside the Kotlin runtime source. The full WaveGames application maintains its
own Android/iOS build, WebView sandbox, BLE, firmware, and board-routing gates.

## Public-source audit

Before publication, the repository is checked for private keys, GitHub/cloud
tokens, signing material, environment files, generated SDK/build output, and
files above the cartridge packaging limits. Generated Flutter, Gradle, and
artifact directories remain ignored.

## Physical acceptance still required

Automated tests do not prove Files/Downloads import, WebView-version behavior,
Bluetooth recovery, radio routing, or real multi-phone play. Exercise every
target Android/iOS version, direct and relayed paths, disconnect/reconnect
behavior, digest mismatch handling, and the intended player roster before
claiming product or physical acceptance.
