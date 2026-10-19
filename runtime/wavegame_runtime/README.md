# Native cartridge runtime snapshot

This Flutter plugin supplies the system document picker and separate visible
and headless-rules WebViews for Android/iOS cartridge hosts. It is not the full
WaveGames app, a rules-engine host, or a radio transport. Cartridge authors
normally use the [JavaScript SDK](../../tools/wavegame/sdk/wavegames-sdk.mjs);
only developers embedding the runtime need this reference.

## Declared build targets

| Component | Declaration in this snapshot |
| --- | --- |
| Plugin version | 0.1.0, not published to pub.dev |
| Dart / Flutter | Dart >=3.7 <4.0; Flutter >=3.24 |
| Android | minSdk 26, compileSdk 36, Java source/target 17, Android Gradle Plugin 9.0.1 |
| iOS | Deployment target 17.0, Swift language version 5.0 |

These are source declarations, not a tested-device matrix. Choose a Flutter
release whose bundled Dart also satisfies the declared Dart constraint. The downloadable
WaveGames Android 0.4.0/build 35 app separately requires Android 12 or newer.
Do not infer that it runs on the plugin's lower Android minimum, or that this
plugin revision is the exact one embedded in the APK. Only Android/iOS native
implementations are included here; there are no desktop plugin implementations.

## Public Dart entrypoints

Import package:wavegame_runtime/wavegame_runtime.dart. Its implementation is
[lib/src/runtime.dart](lib/src/runtime.dart).

| API | Responsibility |
| --- | --- |
| WavegameDocumentImporter.pick() | Return null on cancellation or a private cached copy of one .wavegame selection |
| WavegameStoragePaths.supportDirectory() | Obtain the native app-private installation root |
| WavegameRuntimeController / WavegameView | Own a visible UI runtime and receive typed ready/action/storage/log/lifecycle events |
| WavegameHostMessage / controller.dispatch() | Send the allowed session/view/roster/status/event/action/storage responses |
| WavegameRulesRuntime.create() | Start a separate rules WebView for an installed directory and module |
| invoke / invokeWithResult / invokeWithRandom | Call create/reduce/view and optionally expose deterministic RNG progress |
| dispose() | Destroy a runtime and release its event/request state |

An embedding host must validate and atomically install the package before
passing an installed directory to the runtime. It must own actor/roster
validation, rules serialization, revisions, request deduplication, RNG seed and
counter, filtered views, storage scopes/quotas, and radio/session delivery.
A picker success is not package validation. An existing directory is not
proof that its files are valid or trusted.

Subscribe to controller.events before loading the visible view. Reply to ready
with the host session and to actions/storage operations with correlated
results. The native UI handshake uses a host session message; the simulator
uses a context envelope and MessagePort. The bundled JS client adapts between
them; applications must not assume their raw bridge envelopes are identical.

When using invokeWithRandom for create/reduce, persist randomCounter only for
confirmed committed transitions and roll it back for rejected actions. Do not
supply randomness to view. Destroy the rules runtime on timeout/lifecycle
termination; never commit an unconfirmed transition or reuse a destroyed view.
The 250 ms native watchdog is best-effort; the 500 ms Dart deadline is not a
portable hard CPU-preemption guarantee either.

## Sandbox and testing

This snapshot serves local wavegame://cartridge/ resources on both platforms.
It denies external networking, file/content/data URLs, unrelated navigation,
clipboard, file pickers inside a cartridge, and native device permissions.
Audio requires the declared capability and a user gesture. Storage is supplied
by the host; DOM storage is disabled. The sandbox is not an operating-system
boundary against a compromised WebView. See the detailed
[security contract](SECURITY_CONTRACT.md), including iOS file-picker guards and
renderer/bridge-flooding behavior that still require platform tests.

```sh
flutter pub get
flutter analyze
flutter test
```

Run these from this directory. Native Android tests need an embedding Android
project/Gradle setup; iOS testing needs a host app and Xcode. This repository
contains no runnable example app or standalone Gradle wrapper. Dart tests do
not execute the real native WebViews, document pickers, or Bluetooth.

This component has its own [Apache-2.0 license notice](LICENSE).
