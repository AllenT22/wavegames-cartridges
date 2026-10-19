# Validation and release checks

## Public repository checks

Use Node.js 24 or newer from the repository root. The first-party builder
refuses to replace an existing output directory; choose a fresh path each run.

```sh
node --test tools/wavegame/tests/*.test.mjs
node tools/wavegame/bin/build-first-party.mjs artifacts/verified-release
diff -r releases/1.1.0 artifacts/verified-release
node scripts/check-distribution.mjs
```

On macOS, verify the complete release checksums with:

```sh
(cd releases/1.1.0 && shasum -a 256 -c SHA256SUMS-ALL.txt)
```

On Linux use sha256sum -c SHA256SUMS-ALL.txt from the same directory. The checked-in
GitHub workflow runs toolkit tests, a deterministic rebuild/diff, checksums,
and the distribution audit. It does not build or deploy the full phone app.

At the documentation audit on 2026-10-19, the toolkit reported **30 passing
tests**. The five game reports contained **96 checks** in total: Connect Four
12, Checkers 17, Chess 22, Go 16, Color Match 29. These are a dated result,
not a promise that every possible rule/action or physical setup has been tested.

The toolkit covers CLI/scaffold behavior, the rules determinism guard, strict
JSON/manifest/path checks, canonical digests, ZIP validation, filtered views,
seeded randomness, UI bridge handoff, request timeouts, stale replies, and
simulator reconnect handling. Cartridge tests cover their declared scenarios;
they do not automatically prove that all private information is filtered or
that a rules implementation is complete. Add game-specific privacy and edge cases.

## Immutable releases and reproducibility

The 1.0.0 and 1.1.0 directories are published artifacts. Never rewrite them to
update wording or silently replace a game's content under an existing URL.
The distribution audit checks retained 1.0.0 hashes and both release inventories;
the build/diff checks the complete 1.1.0 output.

The builder reads every game source file, all files under tools/wavegame, and
cartridges/README.md into its source ZIP. Editing those inputs, including a
bundled README, changes the developer archives even if game rules do not change.
Current guidance therefore lives in the root README and docs directory without
rewriting the frozen 1.1.0 toolkit/bundle notes. Those old notes may use the old
Library / Import cartridge labels; [current setup](PLAYING.md) takes precedence
for player UI instructions.

For a new game/toolkit release, coordinate the builder's bundle version,
changed game manifest versions, new release directory, download links, checksums,
and CI comparison target. Preserve previous versioned downloads. App APK
releases have their own version/build and checksum; they are not .wavegame files.

The file SHA-256 and package digest are different: the former checks the whole
archive, while the latter identifies indexed content for matching a lobby.

## Native runtime checks

The included Flutter plugin declares Dart >=3.7 and Flutter >=3.24. Choose a
Flutter release whose bundled Dart meets both constraints. Run:

```sh
cd runtime/wavegame_runtime
flutter pub get
flutter analyze
flutter test
```

These are plugin Dart checks, not a complete application build or execution of
native WebViews. Kotlin tests are present under android/src/test but this repo
has no standalone Gradle wrapper/application; run them through a configured
embedding Android project. iOS device/simulator testing likewise needs a host
app and its normal Xcode/signing setup. Platform version declarations and the
remaining native caveats are in the [runtime README](../runtime/wavegame_runtime/README.md).

## Developer release checklist

- Validate the package and inspect its manifest, ID/version, limits, and digest.
- Run legal/illegal turns, ends/draws/rematches, full roster sizes, and private
  view tests. Verify replay and deterministic random behavior.
- Exercise UI loading, the first view, status/error presentation, disabled
  pending input, timeout ambiguity, and the simulator's fault controls.
- Check phone-width layouts, touch, readable text, focus, locale, themes, and
  declared audio/storage behavior. Package all resources locally.
- Import the exact file on the intended real phones; verify sandbox behavior,
  Bluetooth handoff, direct/repeated LoRa play, disconnect/recovery, and digest
  mismatches. Exercise the intended number of players and host/player departure.
- Check that release archives contain only intended public files, with no
  credentials, private app source, device/player data, or generated caches.

Keep software, install/launch, UI acceptance, and physical radio acceptance
separate in results. Simulator delivery, an APK signature, a successful build,
or a local acknowledgement does not establish range or real multiplayer.
