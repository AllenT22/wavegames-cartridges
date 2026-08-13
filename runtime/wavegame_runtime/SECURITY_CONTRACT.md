# WaveGames native cartridge runtime security contract

This package treats every installed cartridge as untrusted content. It provides
local presentation and rules execution, not an operating-system security
boundary against a compromised WebView implementation.

## Import and storage

- `WavegameDocumentImporter.pick()` uses the Android system document picker or
  iOS Files picker. Native code accepts exactly one regular, non-empty file
  whose displayed name ends in `.wavegame`, streams at most 25 MiB, and returns
  an app-private cache copy. The picker does not grant the cartridge ongoing
  access to the source document.
- Imports live under the platform cache in `wavegame-imports`; they may be
  evicted. Installed cartridges live separately under the persistent private
  root returned by `WavegameStoragePaths.supportDirectory()`. Native code
  creates its `cartridges` child and never accepts a caller-selected support
  root.
- Package signature, manifest, archive-entry, quota, and atomic installation
  checks are the installer's responsibility. This runtime accepts only an
  already-installed directory.

## Resource origin and navigation

- Web content can load only `wavegame://cartridge/<safe-relative-path>` from the
  explicitly supplied installed directory. Paths containing empty, dot,
  dot-dot, backslash, NUL, query, fragment, or an unexpected origin are denied.
- The root and every traversed component are checked for symbolic links; the
  canonical regular file must remain below the canonical root. `__runtime/` is
  reserved for native-generated rules bootstrap resources.
- HTTP(S), `file:`, `content:`, `data:`, external schemes, popups, downloads,
  file choosers, media capture, geolocation, and WebView native permissions are
  denied. CSP also denies network connections, frames, workers, objects, media,
  base changes, and form submission.
- A visible cartridge that declares the `audio` capability may load only audio
  files from its own package origin, with user-gesture playback still required.
  Rules runtimes and cartridges without that capability keep `media-src 'none'`.
- On iOS 17 through 18.3, where WebKit does not expose the native open-panel
  delegate, a document-start guard captures file-input primitives before any
  cartridge module loads and blocks activation. iOS 18.4 and newer additionally
  deny the native open panel. The same guard is installed before authoritative
  rules modules; physical tests across supported iOS versions remain a release
  gate for this defense-in-depth boundary.
- Android disables file/content access, mixed content, network loads, DOM
  storage, databases, form persistence, cookies, and cache. iOS uses a
  non-persistent `WKWebsiteDataStore`; both platforms clear/destroy their view
  on disposal. These settings do not erase state managed by the Flutter host's
  explicit storage API.

## Bridge protocol

- Each runtime has a cryptographically random, per-instance bridge name. Native
  bootstrap captures the bridge in a closure and makes a best-effort attempt to
  delete its named property; the token is not included in the public
  `window.WaveGames` API. WebKit's named message-handler deletion must remain in
  the physical sandbox acceptance matrix because JavaScriptCore property
  behavior can vary by OS release; native ingress and forwarding caps remain
  active even if the property cannot be removed.
- Both directions accept JSON-compatible envelopes of at most 128 KiB and a
  maximum nesting depth of 32 before native JSON parsing. Native
  code permits only typed events. Visible cartridge events are `ready`,
  `action`, `storage.get`, `storage.set`, `storage.remove`, `log`, and native
  `lifecycle`. Host messages are `session`, `view`, `roster`, `status`,
  `event`, `storage.result`, `action.result`, and `error`.
- JavaScript bootstrap allows a burst of 64 visible posts with 32-per-second
  refill, or 16 rules posts with 16-per-second refill, and bounds unresolved
  action/storage/connect promises. Android also bounds messages before posting
  them to its main thread. Both native runtimes
  cap outstanding Flutter events, apply a token bucket, reserve one terminal
  lifecycle slot, and destroy the runtime on bridge flooding.
- Clipboard access is denied before cartridge code: the navigator property,
  `Clipboard` prototype methods, and legacy copy/cut/paste `execCommand` paths
  are shadowed. Physical testing remains required for WebView-version-specific
  clipboard surfaces.
- `window.WaveGames.connect({api: 1})` sends `ready` and resolves only after a
  host `session` message. Its client exposes `context`, Promise-returning
  `sendAction`, `onView`, `onRoster`, `onStatus`, `onEvent`, `storage`, and
  `log`.
  `sendAction` is correlated by request ID with `action.result` payload
  `{requestId, value}` or `{requestId, error}`. The runtime dispatches
  `wavegames:runtime-ready` immediately after installing the global.
- On iOS the visible bootstrap is a document-start user script. On Android the
  runtime serves the entry HTML through its scheme handler, requires a valid
  `head`, and inserts the reserved synchronous bootstrap as its first child,
  before any cartridge script. Ambiguous pre-head comment/CDATA markup is
  rejected so it cannot swallow a regex-selected head. The original doctype is preserved. Entrypoint
  HTML is strict UTF-8 and limited to 2 MiB. Both paths install the host receiver
  and signal native readiness before dispatching `wavegames:runtime-ready`, so
  a module may safely use top-level `await WaveGames.connect({api: 1})` without
  blocking the host session handshake.

## Authoritative rules and deterministic randomness

- Rules run in a separate, headless, destroyable WebView. API 1 invokes only
  `create`, `reduce`, and `view`; each invocation is JSON-only.
- `create` and `reduce` may receive
  `random: {seed: uint32, counter: uint32}`. Native bootstrap replaces that
  descriptor with frozen `nextFloat()` and `nextInt(maximum)` functions, then
  returns `{value, randomCounter}`. `view` has any `random` field removed.
- The algorithm exactly matches the developer SimulationHost's Mulberry32:
  initialize state to `seed || 0x6d2b79f5`, advance it once per draw by
  `0x6d2b79f5`, apply the same 32-bit `Math.imul` xor mixing, and divide the
  unsigned output by `2^32`. A nonzero starting counter reconstructs state as
  `seedOrDefault + counter * 0x6d2b79f5 (mod 2^32)`. `nextInt(max)` is
  `floor(nextFloat() * max)`. Counter overflow wraps modulo `2^32`.
- Authoritative `Math.random`, crypto entropy, wall/performance clocks, timers,
  animation frames, and Web storage are disabled before the rules module is
  imported. The host owns and persists the returned counter.
  `WavegameRulesRuntime.invoke()`
  unwraps the game value; `invokeWithResult()` and `invokeWithRandom()` expose
  `WavegameRulesResult.randomCounter`.

## Watchdog limitation

The native host schedules a 250 ms main-loop watchdog before every rules call.
If JavaScript yields, rejects, or the content process reports unresponsiveness,
the pending call is failed and the entire rules WebView is destroyed. A tight
in-process JavaScript loop can monopolize the WebView renderer and delay its
message, but WebKit/Android WebView do not expose a portable hard per-script CPU
interrupt. The watchdog therefore provides fail-closed, best-effort detection,
not a strict 250 ms preemption guarantee. The Flutter side has an additional
500 ms timeout and destroys the runtime. A rules timeout is fatal; callers must
create a fresh rules runtime and must not accept an unconfirmed transition.

Renderer crash/termination and Android renderer-unresponsive callbacks emit a
typed lifecycle notification and destroy the runtime. Physical-device testing
is still required for OS-version-specific WebView process behavior.
