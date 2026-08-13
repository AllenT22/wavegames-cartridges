import Foundation
import UIKit
import WebKit

final class SandboxedWebViewRuntime: NSObject, WKNavigationDelegate, WKUIDelegate,
  WKScriptMessageHandler
{
  enum Mode { case visible, rules }

  let runtimeId: String
  private weak var registry: RuntimeRegistry?
  private let root: SafeResourceRoot
  private let channelToken: String
  private let entrypoint: String
  private let maximumEnvelopeBytes: Int
  private let mode: Mode
  private let watchdogMilliseconds: Int
  private let schemeHandler: WavegameSchemeHandler
  private var webView: WKWebView?
  private var pendingRules: [String: DispatchWorkItem] = [:]
  private var pendingFlutterEvents = 0
  private var bridgeEventTokens = 64.0
  private var lastBridgeTokenRefill = ProcessInfo.processInfo.systemUptime
  private var destroyed = false

  var view: UIView { webView ?? UIView() }

  init(
    registry: RuntimeRegistry,
    runtimeId: String,
    channelToken: String,
    installedDirectory: String,
    entrypoint: String,
    maximumEnvelopeBytes: Int,
    mode: Mode,
    watchdogMilliseconds: Int,
    allowAudio: Bool
  ) throws {
    guard (1024...(128 * 1024)).contains(maximumEnvelopeBytes) else {
      throw RuntimeFailure.invalidArgument("Invalid maximum envelope size")
    }
    guard SafeResourceRoot.isSafeRelativePath(entrypoint) else {
      throw RuntimeFailure.invalidArgument("Entrypoint is not a safe relative path")
    }
    let tokenExpression = try NSRegularExpression(pattern: "^[A-Za-z_][A-Za-z0-9_]{15,128}$")
    let tokenRange = NSRange(channelToken.startIndex..., in: channelToken)
    guard tokenExpression.firstMatch(in: channelToken, range: tokenRange) != nil else {
      throw RuntimeFailure.invalidArgument("Channel token is invalid")
    }
    if mode == .rules, !(1...250).contains(watchdogMilliseconds) {
      throw RuntimeFailure.invalidArgument("Rules watchdog exceeds 250ms")
    }

    let safeRoot = try SafeResourceRoot(path: installedDirectory)
    self.registry = registry
    self.runtimeId = runtimeId
    self.root = safeRoot
    self.channelToken = channelToken
    self.entrypoint = entrypoint
    self.maximumEnvelopeBytes = maximumEnvelopeBytes
    self.mode = mode
    self.watchdogMilliseconds = watchdogMilliseconds
    self.schemeHandler = WavegameSchemeHandler(
      root: safeRoot,
      mode: mode == .visible ? .visible : .rules,
      entrypoint: entrypoint,
      channelToken: channelToken,
      maximumEnvelopeBytes: maximumEnvelopeBytes,
      allowAudio: mode == .visible && allowAudio
    )
    super.init()

    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    configuration.mediaTypesRequiringUserActionForPlayback = .all
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    configuration.setURLSchemeHandler(schemeHandler, forURLScheme: SafeResourceRoot.scheme)
    configuration.userContentController.add(self, name: channelToken)
    if mode == .visible {
      configuration.userContentController.addUserScript(
        WKUserScript(
          source: visibleBootstrap,
          injectionTime: .atDocumentStart,
          forMainFrameOnly: true,
          in: .page
        )
      )
    }

    let created = WKWebView(frame: .zero, configuration: configuration)
    created.navigationDelegate = self
    created.uiDelegate = self
    created.isOpaque = false
    created.backgroundColor = .clear
    created.scrollView.backgroundColor = .clear
    created.allowsBackForwardNavigationGestures = false
    webView = created
  }

  func startVisible() {
    guard mode == .visible else { return }
    load(relativePath: entrypoint)
  }

  func startRules() {
    guard mode == .rules else { return }
    load(relativePath: WavegameSchemeHandler.rulesDocument)
  }

  private func load(relativePath: String) {
    guard let url = URL(string: "wavegame://cartridge/\(relativePath)") else { return }
    webView?.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
  }

  func dispatch(envelope: [String: Any?]) throws {
    guard mode == .visible, !destroyed, let webView else {
      throw RuntimeFailure.inactive("Visible runtime is not active")
    }
    let object = Self.jsonObject(envelope)
    guard JSONSerialization.isValidJSONObject(object) else {
      throw RuntimeFailure.bridge("Host envelope is not JSON-compatible")
    }
    let normalizedData = try JSONSerialization.data(withJSONObject: object)
    guard normalizedData.count <= maximumEnvelopeBytes else {
      throw RuntimeFailure.bridge("Host envelope exceeds \(maximumEnvelopeBytes) bytes")
    }
    let base64 = normalizedData.base64EncodedString()
    webView.evaluateJavaScript(
      "window.__wavegamesReceiveBase64 && window.__wavegamesReceiveBase64('\(base64)');"
    )
  }

  func invokeRules(requestId: String, function: String, argument: Any?) throws {
    guard mode == .rules, !destroyed, let webView else {
      throw RuntimeFailure.inactive("Rules runtime is not active")
    }
    guard requestId.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil else {
      throw RuntimeFailure.invalidArgument("Invalid request ID")
    }
    guard Self.allowedRulesFunctions.contains(function) else {
      throw RuntimeFailure.invalidArgument("Unsupported rules function")
    }
    guard pendingRules[requestId] == nil else {
      throw RuntimeFailure.invalidArgument("Rules request is already pending")
    }
    guard pendingRules.count < Self.maximumPendingRulesRequests else {
      throw RuntimeFailure.bridge("Too many rules requests are pending")
    }
    let wrapper = ["value": argument ?? NSNull()]
    guard JSONSerialization.isValidJSONObject(wrapper) else {
      throw RuntimeFailure.bridge("Rules argument is not JSON-compatible")
    }
    let argumentData = try JSONSerialization.data(withJSONObject: wrapper)
    guard argumentData.count <= maximumEnvelopeBytes else {
      throw RuntimeFailure.bridge("Rules argument exceeds \(maximumEnvelopeBytes) bytes")
    }
    let argumentJSON = String(decoding: argumentData, as: UTF8.self)
    let script = rulesInvocationScript(
      requestId: requestId,
      function: function,
      argumentJSON: "(\(argumentJSON)).value"
    )
    let timeout = DispatchWorkItem { [weak self] in
      guard let self, self.pendingRules.removeValue(forKey: requestId) != nil,
        !self.destroyed
      else { return }
      self.forwardToFlutter(["type": "rules.timeout", "requestId": requestId])
      self.destroy(
        state: "rulesTimeout",
        detail: "Rules call exceeded \(self.watchdogMilliseconds)ms",
        notify: false
      )
    }
    pendingRules[requestId] = timeout
    DispatchQueue.main.asyncAfter(
      deadline: .now() + .milliseconds(watchdogMilliseconds),
      execute: timeout
    )
    webView.evaluateJavaScript(script)
  }

  func destroy(state: String, detail: String?, notify: Bool) {
    guard !destroyed else { return }
    destroyed = true
    pendingRules.values.forEach { $0.cancel() }
    pendingRules.removeAll()
    if notify { emitLifecycle(state: state, detail: detail, critical: true) }
    if let webView {
      webView.stopLoading()
      webView.configuration.userContentController.removeScriptMessageHandler(forName: channelToken)
      webView.configuration.userContentController.removeAllUserScripts()
      webView.navigationDelegate = nil
      webView.uiDelegate = nil
      webView.removeFromSuperview()
    }
    webView = nil
    registry?.runtimeDestroyed(self)
  }

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) {
    guard message.name == channelToken, !destroyed else { return }
    guard let encoded = message.body as? String,
      encoded.utf16.count <= maximumEnvelopeBytes,
      encoded.utf8.count <= maximumEnvelopeBytes
    else {
      failBridgeFlood("Bridge envelope exceeds \(maximumEnvelopeBytes) bytes")
      return
    }
    do {
      let envelope = try decodeEnvelope(encoded)
      guard let type = envelope["type"] as? String else {
        throw RuntimeFailure.bridge("Bridge event has no type")
      }
      if mode == .visible {
        guard Self.allowedVisibleEvents.contains(type) else {
          throw RuntimeFailure.bridge("Unsupported UI bridge event")
        }
        forwardToFlutter(envelope)
      } else {
        guard Self.allowedRulesEvents.contains(type) else {
          throw RuntimeFailure.bridge("Unsupported rules bridge event")
        }
        if type == "rules.result" || type == "rules.error" {
          guard let rawRequestId = envelope["requestId"] ?? nil else { return }
          let requestId = String(describing: rawRequestId)
          guard
            let timeout = pendingRules.removeValue(forKey: requestId)
          else { return }
          timeout.cancel()
        }
        forwardToFlutter(envelope)
      }
    } catch {
      emitLifecycle(state: "bridgeViolation", detail: error.localizedDescription)
      if mode == .rules {
        destroy(state: "bridgeViolation", detail: error.localizedDescription, notify: false)
      }
    }
  }

  private func decodeEnvelope(_ encoded: String) throws -> [String: Any?] {
    let data = Data(encoded.utf8)
    try Self.validateJSONNesting(encoded)
    let object = try JSONSerialization.jsonObject(with: data)
    guard JSONSerialization.isValidJSONObject(object) else {
      throw RuntimeFailure.bridge("Bridge envelope is not JSON-compatible")
    }
    let normalizedData = try JSONSerialization.data(withJSONObject: object)
    guard normalizedData.count <= maximumEnvelopeBytes else {
      throw RuntimeFailure.bridge("Bridge envelope exceeds \(maximumEnvelopeBytes) bytes")
    }
    guard let envelope = object as? [String: Any] else {
      throw RuntimeFailure.bridge("Bridge envelope must be an object")
    }
    return envelope.mapValues { value -> Any? in
      value is NSNull ? nil : value
    }
  }

  private static func validateJSONNesting(_ encoded: String, maximumDepth: Int = 32) throws {
    var depth = 0
    var inString = false
    var escaped = false
    for scalar in encoded.unicodeScalars {
      if inString {
        if escaped {
          escaped = false
        } else if scalar.value == 0x5c {
          escaped = true
        } else if scalar.value == 0x22 {
          inString = false
        }
        continue
      }
      switch scalar.value {
      case 0x22:
        inString = true
      case 0x7b, 0x5b:
        depth += 1
        guard depth <= maximumDepth else {
          throw RuntimeFailure.bridge("Bridge envelope exceeds JSON depth \(maximumDepth)")
        }
      case 0x7d, 0x5d:
        depth -= 1
        guard depth >= 0 else {
          throw RuntimeFailure.bridge("Bridge envelope has invalid JSON nesting")
        }
      default:
        break
      }
    }
    guard !inString, !escaped, depth == 0 else {
      throw RuntimeFailure.bridge("Bridge envelope has invalid JSON nesting")
    }
  }

  private func emitLifecycle(state: String, detail: String?, critical: Bool = false) {
    let payload: [String: Any] = [
      "state": state,
      "detail": detail.map { $0 as Any } ?? NSNull(),
    ]
    forwardToFlutter(
      [
        "type": "lifecycle",
        "payload": payload,
      ],
      critical: critical
    )
  }

  private func forwardToFlutter(_ envelope: [String: Any?], critical: Bool = false) {
    if destroyed && !critical { return }
    guard let registry else { return }
    refillBridgeTokens()
    let pendingLimit = critical
      ? Self.maximumPendingFlutterEvents
      : Self.maximumPendingFlutterEvents - 1
    guard pendingFlutterEvents < pendingLimit,
      critical || bridgeEventTokens >= 1
    else {
      if !critical { failBridgeFlood("Bridge event rate or pending limit exceeded") }
      return
    }
    if !critical { bridgeEventTokens -= 1 }
    pendingFlutterEvents += 1
    registry.emit(runtimeId: runtimeId, envelope: envelope) { [weak self] in
      DispatchQueue.main.async {
        guard let self else { return }
        self.pendingFlutterEvents = max(0, self.pendingFlutterEvents - 1)
      }
    }
  }

  private func refillBridgeTokens() {
    let now = ProcessInfo.processInfo.systemUptime
    let elapsed = max(0, now - lastBridgeTokenRefill)
    bridgeEventTokens = min(
      Self.bridgeEventBurst,
      bridgeEventTokens + elapsed * Self.bridgeEventsPerSecond
    )
    lastBridgeTokenRefill = now
  }

  private func failBridgeFlood(_ detail: String) {
    guard !destroyed else { return }
    destroy(state: "bridgeFlood", detail: detail, notify: true)
  }

  private func rulesInvocationScript(
    requestId: String,
    function: String,
    argumentJSON: String
  ) -> String {
    let request = WavegameSchemeHandler.javascriptString(requestId)
    let functionName = WavegameSchemeHandler.javascriptString(function)
    return """
    (() => {
      const requestId = \(request);
      const post = globalThis.__wavegamesRulesPost;
      const fail = (error) => post({
        type: 'rules.error', requestId,
        message: String(error && error.message ? error.message : error).slice(0, 4096)
      });
      Promise.resolve().then(async () => {
        const fn = globalThis.__wavegamesRules && globalThis.__wavegamesRules[\(functionName)];
        if (typeof fn !== 'function') throw new Error('Rules function is not exported');
        const input = \(argumentJSON);
        let argument = input;
        let randomCounter = null;
        if (\(functionName) === 'view') {
          if (input && typeof input === 'object' && !Array.isArray(input)) {
            const {random: ignored, ...withoutRandom} = input;
            argument = withoutRandom;
          }
        } else if (input && typeof input === 'object' && !Array.isArray(input) && input.random != null) {
          const descriptor = input.random;
          if (!descriptor || typeof descriptor !== 'object' ||
              !Number.isInteger(descriptor.seed) || descriptor.seed < 0 || descriptor.seed > 0xffffffff ||
              !Number.isInteger(descriptor.counter) || descriptor.counter < 0 || descriptor.counter > 0xffffffff) {
            throw new TypeError('random must contain uint32 seed and counter');
          }
          const increment = 0x6d2b79f5;
          let counter = descriptor.counter >>> 0;
          let state = (((descriptor.seed >>> 0) || increment) + Math.imul(counter, increment)) >>> 0;
          const random = Object.freeze({
            nextFloat: () => {
              state = (state + increment) >>> 0;
              counter = (counter + 1) >>> 0;
              let value = state;
              value = Math.imul(value ^ (value >>> 15), value | 1);
              value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
              return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
            },
            nextInt: (maximum) => {
              if (!Number.isInteger(maximum) || maximum <= 0) {
                throw new TypeError('maximum must be a positive integer');
              }
              return Math.floor(random.nextFloat() * maximum);
            }
          });
          argument = {...input, random};
          randomCounter = () => counter;
        }
        const value = await fn(argument);
        const payload = {value};
        if (randomCounter) payload.randomCounter = randomCounter();
        post({type: 'rules.result', requestId, payload});
      }).catch(fail);
    })();
    """
  }

  private var visibleBootstrap: String {
    let token = WavegameSchemeHandler.javascriptString(channelToken)
    return """
    (() => {
      if (window.WaveGames) return;
      const native = window.webkit.messageHandlers[\(token)];
      const listeners = new Map();
      const pendingStorage = new Map();
      const pendingActions = new Map();
      const pendingConnections = new Set();
      const maximumPendingRequests = 32;
      const maximumPendingConnections = 8;
      const stringify = JSON.stringify.bind(JSON);
      const encodeText = TextEncoder.prototype.encode.bind(new TextEncoder());
      const bridgeNow = performance.now.bind(performance);
      const bridgeMin = Math.min.bind(Math);
      const bridgeMax = Math.max.bind(Math);
      const maximumBridgeTokens = 64;
      let bridgeTokens = maximumBridgeTokens;
      let lastBridgeRefill = bridgeNow();
      const takeBridgeToken = () => {
        const now = bridgeNow();
        bridgeTokens = bridgeMin(
          maximumBridgeTokens,
          bridgeTokens + bridgeMax(0, now - lastBridgeRefill) * 0.032
        );
        lastBridgeRefill = now;
        if (bridgeTokens < 1) throw new Error('Bridge rate limit exceeded');
        bridgeTokens -= 1;
      };
      let sessionContext;
      let nextRequest = 0;
      const send = (type, payload, requestId) => {
        takeBridgeToken();
        const envelope = {type, payload};
        if (requestId !== undefined) envelope.requestId = requestId;
        const encoded = stringify(envelope);
        if (encoded.length > \(maximumEnvelopeBytes) ||
            encodeText(encoded).byteLength > \(maximumEnvelopeBytes)) {
          throw new RangeError('Bridge envelope is too large');
        }
        native.postMessage(encoded);
      };
      const closest = Element.prototype.closest;
      const getAttribute = Element.prototype.getAttribute;
      const labelControlGetter = Object.getOwnPropertyDescriptor(
        HTMLLabelElement.prototype, 'control'
      )?.get;
      const isFileInput = (value) => value instanceof HTMLInputElement &&
        String(getAttribute.call(value, 'type') || '').toLowerCase() === 'file';
      const fileInputFor = (target) => {
        if (!(target instanceof Element)) return null;
        const direct = closest.call(target, 'input[type="file"]');
        if (direct) return direct;
        const label = closest.call(target, 'label');
        const control = label && labelControlGetter ? labelControlGetter.call(label) : null;
        return isFileInput(control) ? control : null;
      };
      window.addEventListener('click', (event) => {
        if (!fileInputFor(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        send('lifecycle', {state: 'blockedFileChooser'});
      }, true);
      const inputPrototype = HTMLInputElement.prototype;
      const originalInputClick = inputPrototype.click;
      Object.defineProperty(inputPrototype, 'click', {
        value: function() {
          if (isFileInput(this)) {
            send('lifecycle', {state: 'blockedFileChooser'});
            return;
          }
          return originalInputClick.call(this);
        }, writable: false, configurable: false
      });
      if (typeof inputPrototype.showPicker === 'function') {
        const originalShowPicker = inputPrototype.showPicker;
        Object.defineProperty(inputPrototype, 'showPicker', {
          value: function() {
            if (isFileInput(this)) {
              send('lifecycle', {state: 'blockedFileChooser'});
              return;
            }
            return originalShowPicker.call(this);
          }, writable: false, configurable: false
        });
      }
      try {
        Object.defineProperty(navigator, 'clipboard', {
          get: () => undefined, configurable: false
        });
      } catch (_) {}
      if (globalThis.Navigator && Navigator.prototype) {
        try { Object.defineProperty(Navigator.prototype, 'clipboard', {
          get: () => undefined, configurable: false
        }); } catch (_) {}
      }
      if (globalThis.Clipboard && Clipboard.prototype) {
        for (const name of ['read', 'readText', 'write', 'writeText']) {
          try { Object.defineProperty(Clipboard.prototype, name, {
            value: () => Promise.reject(new Error('Clipboard access is blocked')),
            writable: false, configurable: false
          }); } catch (_) {}
        }
      }
      const originalExecCommand = document.execCommand && document.execCommand.bind(document);
      if (originalExecCommand) {
        const guardedExecCommand = (command, ...args) =>
          ['copy', 'cut', 'paste'].includes(String(command).toLowerCase())
            ? false : originalExecCommand(command, ...args);
        try { Object.defineProperty(Document.prototype, 'execCommand', {
          value: guardedExecCommand, writable: false, configurable: false
        }); } catch (_) {}
        try { Object.defineProperty(document, 'execCommand', {
          value: guardedExecCommand, writable: false, configurable: false
        }); } catch (_) {}
      }
      const on = (type, callback) => {
        if (typeof callback !== 'function') throw new TypeError('callback must be a function');
        const values = listeners.get(type) || new Set(); values.add(callback); listeners.set(type, values);
        return () => values.delete(callback);
      };
      const request = (pending, prefix, type, payload) => new Promise((resolve, reject) => {
        if (pendingStorage.size + pendingActions.size >= maximumPendingRequests) {
          reject(new Error('Too many WaveGames requests are pending'));
          return;
        }
        const requestId = prefix + String(++nextRequest);
        pending.set(requestId, {resolve, reject});
        try {
          send(type, payload, requestId);
        } catch (error) {
          pending.delete(requestId);
          reject(error);
        }
      });
      const storage = (type, payload) => request(pendingStorage, 's', type, payload);
      const client = Object.freeze({
        get context() { return sessionContext; },
        sendAction: (action) => request(pendingActions, 'a', 'action', action),
        onView: (callback) => on('view', callback),
        onRoster: (callback) => on('roster', callback),
        onStatus: (callback) => on('status', callback),
        onEvent: (callback) => on('event', callback),
        storage: Object.freeze({
          get: (key) => storage('storage.get', {key}),
          set: (key, value) => storage('storage.set', {key, value}),
          remove: (key) => storage('storage.remove', {key})
        }),
        log: (level, message) => send('log', {level, message: String(message).slice(0, 4096)})
      });
      const api = Object.freeze({
        connect: (details) => {
          if (!details || details.api !== 1) return Promise.reject(new Error('WaveGames API 1 is required'));
          if (sessionContext !== undefined) return Promise.resolve(client);
          if (pendingConnections.size >= maximumPendingConnections) {
            return Promise.reject(new Error('Too many WaveGames connections are pending'));
          }
          try { send('ready', details); } catch (error) { return Promise.reject(error); }
          return new Promise((resolve) => pendingConnections.add(resolve));
        }
      });
      Object.defineProperty(window, 'WaveGames', {value: api, writable: false, configurable: false});
      try { delete window.webkit.messageHandlers[\(token)]; } catch (_) {}
      window.__wavegamesReceiveBase64 = (encoded) => {
        const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
        const envelope = JSON.parse(new TextDecoder().decode(bytes));
        if (envelope.type === 'session') {
          sessionContext = envelope.payload;
          pendingConnections.forEach(resolve => resolve(client));
          pendingConnections.clear();
        }
        if (envelope.type === 'storage.result' && envelope.payload && envelope.payload.requestId != null) {
          const request = pendingStorage.get(String(envelope.payload.requestId));
          if (request) {
            pendingStorage.delete(String(envelope.payload.requestId));
            envelope.payload.error ? request.reject(new Error(String(envelope.payload.error))) : request.resolve(envelope.payload.value);
          }
        }
        if (envelope.type === 'action.result' && envelope.payload && envelope.payload.requestId != null) {
          const request = pendingActions.get(String(envelope.payload.requestId));
          if (request) {
            pendingActions.delete(String(envelope.payload.requestId));
            envelope.payload.error ? request.reject(new Error(String(envelope.payload.error))) : request.resolve(envelope.payload.value);
          }
        }
        (listeners.get(envelope.type) || []).forEach(callback => callback(envelope.payload));
        window.dispatchEvent(new CustomEvent('wavegames:host', {detail: envelope}));
      };
      send('lifecycle', {state: 'ready'});
      window.dispatchEvent(new Event('wavegames:runtime-ready'));
    })();
    """
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    guard navigationAction.targetFrame != nil, let url = navigationAction.request.url,
      isAllowedNavigation(url)
    else {
      emitLifecycle(state: "blockedNavigation", detail: navigationAction.request.url?.scheme)
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationResponse: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
  ) {
    decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
  }

  private func isAllowedNavigation(_ url: URL) -> Bool {
    if root.resolve(url: url) != nil { return true }
    guard mode == .rules, url.scheme == SafeResourceRoot.scheme,
      url.host == SafeResourceRoot.host
    else { return false }
    let relative = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    return relative == WavegameSchemeHandler.rulesDocument
      || relative == WavegameSchemeHandler.rulesBridge
      || relative == WavegameSchemeHandler.rulesBootstrap
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    destroy(
      state: "rendererCrashed",
      detail: "Web content process was terminated",
      notify: true
    )
  }

  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    emitLifecycle(state: "blockedPopup", detail: nil)
    return nil
  }

  @available(iOS 15.0, *)
  func webView(
    _ webView: WKWebView,
    requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType,
    decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    emitLifecycle(state: "blockedPermission", detail: nil)
    decisionHandler(.deny)
  }

  @available(iOS 18.4, *)
  func webView(
    _ webView: WKWebView,
    runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping ([URL]?) -> Void
  ) {
    emitLifecycle(state: "blockedFileChooser", detail: nil)
    completionHandler(nil)
  }

  private static let allowedVisibleEvents: Set<String> = [
    "ready", "action", "storage.get", "storage.set", "storage.remove", "log", "lifecycle",
  ]
  private static let allowedRulesEvents: Set<String> = [
    "rules.ready", "rules.result", "rules.error",
  ]
  private static let allowedRulesFunctions: Set<String> = [
    "create", "reduce", "view",
  ]
  private static let maximumPendingFlutterEvents = 32
  private static let maximumPendingRulesRequests = 8
  private static let bridgeEventBurst = 64.0
  private static let bridgeEventsPerSecond = 32.0

  private static func jsonObject(_ value: Any?) -> Any {
    switch value {
    case nil: return NSNull()
    case let dictionary as [String: Any?]:
      return dictionary.mapValues { jsonObject($0) }
    case let array as [Any?]: return array.map { jsonObject($0) }
    default: return value as Any
    }
  }
}
