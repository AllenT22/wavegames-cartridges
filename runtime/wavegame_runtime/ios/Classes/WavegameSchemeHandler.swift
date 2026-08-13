import Foundation
import WebKit

final class WavegameSchemeHandler: NSObject, WKURLSchemeHandler {
  enum Mode { case visible, rules }

  private let root: SafeResourceRoot
  private let mode: Mode
  private let entrypoint: String
  private let channelToken: String
  private let maximumEnvelopeBytes: Int
  private let allowAudio: Bool

  init(
    root: SafeResourceRoot,
    mode: Mode,
    entrypoint: String,
    channelToken: String,
    maximumEnvelopeBytes: Int,
    allowAudio: Bool
  ) {
    self.root = root
    self.mode = mode
    self.entrypoint = entrypoint
    self.channelToken = channelToken
    self.maximumEnvelopeBytes = maximumEnvelopeBytes
    self.allowAudio = allowAudio
  }

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let url = urlSchemeTask.request.url, url.scheme == SafeResourceRoot.scheme,
      url.host == SafeResourceRoot.host, url.query == nil, url.fragment == nil
    else {
      finish(task: urlSchemeTask, status: 403, mime: "text/plain", data: Data())
      return
    }
    let relative = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    if mode == .rules, relative == Self.rulesDocument {
      finish(
        task: urlSchemeTask,
        status: 200,
        mime: "text/html",
        data: Data(rulesDocument.utf8)
      )
      return
    }
    if mode == .rules, relative == Self.rulesBootstrap {
      finish(
        task: urlSchemeTask,
        status: 200,
        mime: "text/javascript",
        data: Data(rulesBootstrap.utf8)
      )
      return
    }
    if mode == .rules, relative == Self.rulesBridge {
      finish(
        task: urlSchemeTask,
        status: 200,
        mime: "text/javascript",
        data: Data(rulesBridge.utf8)
      )
      return
    }
    guard !relative.hasPrefix("__runtime/"), let resource = root.resolve(url: url),
      let data = try? Data(contentsOf: resource, options: .mappedIfSafe)
    else {
      finish(task: urlSchemeTask, status: 403, mime: "text/plain", data: Data())
      return
    }
    finish(task: urlSchemeTask, status: 200, mime: Self.mimeType(resource), data: data)
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
    // Responses are bounded local reads and complete synchronously.
  }

  private func finish(task: WKURLSchemeTask, status: Int, mime: String, data: Data) {
    guard let url = task.request.url else { return }
    let headers = [
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": mime,
      "Content-Security-Policy": contentSecurityPolicy,
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    ]
    let response = HTTPURLResponse(
      url: url,
      statusCode: status,
      httpVersion: "HTTP/1.1",
      headerFields: headers
    ) ?? URLResponse(
      url: url,
      mimeType: mime,
      expectedContentLength: data.count,
      textEncodingName: Self.isTextMime(mime) ? "utf-8" : nil
    )
    task.didReceive(response)
    if !data.isEmpty { task.didReceive(data) }
    task.didFinish()
  }

  private var rulesDocument: String {
    """
    <!doctype html><html><head><meta charset="utf-8"></head>
    <body><script src="/\(Self.rulesBridge)"></script><script type="module" src="/\(Self.rulesBootstrap)"></script></body></html>
    """
  }

  private var rulesBridge: String {
    let token = Self.javascriptString(channelToken)
    return """
    (() => {
      const native = window.webkit.messageHandlers[\(token)];
      const stringify = JSON.stringify.bind(JSON);
      const encodeText = TextEncoder.prototype.encode.bind(new TextEncoder());
      const bridgeNow = performance.now.bind(performance);
      const bridgeMin = Math.min.bind(Math);
      const bridgeMax = Math.max.bind(Math);
      const maximumBridgeTokens = 16;
      let bridgeTokens = maximumBridgeTokens;
      let lastBridgeRefill = bridgeNow();
      const takeBridgeToken = () => {
        const now = bridgeNow();
        bridgeTokens = bridgeMin(
          maximumBridgeTokens,
          bridgeTokens + bridgeMax(0, now - lastBridgeRefill) * 0.016
        );
        lastBridgeRefill = now;
        if (bridgeTokens < 1) throw new Error('Rules bridge rate limit exceeded');
        bridgeTokens -= 1;
      };
      const post = (envelope) => {
        takeBridgeToken();
        const encoded = stringify(envelope);
        if (encoded.length > \(maximumEnvelopeBytes) ||
            encodeText(encoded).byteLength > \(maximumEnvelopeBytes)) {
          throw new RangeError('Rules bridge envelope is too large');
        }
        native.postMessage(encoded);
      };
      const nondeterministic = () => {
        throw new Error('Nondeterministic platform APIs are forbidden in authoritative rules');
      };
      for (const storageName of ['localStorage', 'sessionStorage', 'indexedDB']) {
        try { Object.defineProperty(globalThis, storageName, {
          get: nondeterministic, configurable: false
        }); } catch (_) {}
      }
      try { Object.defineProperty(globalThis, 'crypto', {
        value: undefined, writable: false, configurable: false
      }); } catch (_) {}
      try { Object.defineProperty(globalThis, 'performance', {
        value: undefined, writable: false, configurable: false
      }); } catch (_) {}
      for (const timerName of ['setTimeout', 'setInterval', 'requestAnimationFrame']) {
        try { Object.defineProperty(globalThis, timerName, {
          value: nondeterministic, writable: false, configurable: false
        }); } catch (_) {}
      }
      const OriginalDate = Date;
      const deterministicConstruct = Reflect.construct.bind(Reflect);
      const DeterministicDate = function(...args) {
        if (args.length === 0 || !new.target) return nondeterministic();
        return deterministicConstruct(OriginalDate, args, new.target);
      };
      Object.defineProperty(DeterministicDate, 'prototype', {
        value: OriginalDate.prototype, writable: false, configurable: false
      });
      Object.defineProperty(OriginalDate.prototype, 'constructor', {
        value: DeterministicDate, writable: false, configurable: false
      });
      for (const name of ['parse', 'UTC']) {
        Object.defineProperty(DeterministicDate, name, {
          value: OriginalDate[name].bind(OriginalDate), writable: false, configurable: false
        });
      }
      Object.defineProperty(DeterministicDate, 'now', {
        value: nondeterministic, writable: false, configurable: false
      });
      Object.defineProperty(globalThis, 'Date', {
        value: DeterministicDate, writable: false, configurable: false
      });
      const deterministicApply = Reflect.apply.bind(Reflect);
      const dateTimeFormatPrototype = globalThis.Intl &&
        globalThis.Intl.DateTimeFormat && globalThis.Intl.DateTimeFormat.prototype;
      if (dateTimeFormatPrototype) {
        const formatDescriptor = Object.getOwnPropertyDescriptor(
          dateTimeFormatPrototype, 'format'
        );
        if (formatDescriptor && typeof formatDescriptor.get === 'function') {
          const originalFormat = formatDescriptor.get;
          const wrappedFormats = new WeakMap();
          Object.defineProperty(dateTimeFormatPrototype, 'format', {
            get() {
              let wrapped = wrappedFormats.get(this);
              if (wrapped) return wrapped;
              const format = deterministicApply(originalFormat, this, []);
              wrapped = function(value) {
                if (arguments.length === 0 || value === undefined) return nondeterministic();
                return deterministicApply(format, undefined, arguments);
              };
              wrappedFormats.set(this, wrapped);
              return wrapped;
            },
            enumerable: formatDescriptor.enumerable,
            configurable: false
          });
        }
        const formatToParts = dateTimeFormatPrototype.formatToParts;
        if (typeof formatToParts === 'function') {
          Object.defineProperty(dateTimeFormatPrototype, 'formatToParts', {
            value: function(value) {
              if (arguments.length === 0 || value === undefined) return nondeterministic();
              return deterministicApply(formatToParts, this, arguments);
            },
            writable: false, enumerable: false, configurable: false
          });
        }
      }
      if (globalThis.Temporal &&
          (typeof globalThis.Temporal === 'object' || typeof globalThis.Temporal === 'function')) {
        Object.defineProperty(globalThis.Temporal, 'Now', {
          value: undefined, writable: false, configurable: false
        });
      } else {
        Object.defineProperty(globalThis, 'Temporal', {
          value: undefined, writable: false, configurable: false
        });
      }
      const getAttribute = Element.prototype.getAttribute;
      const isFileInput = (value) => value instanceof HTMLInputElement &&
        String(getAttribute.call(value, 'type') || '').toLowerCase() === 'file';
      window.addEventListener('click', (event) => {
        if (!isFileInput(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
      const inputPrototype = HTMLInputElement.prototype;
      const originalInputClick = inputPrototype.click;
      Object.defineProperty(inputPrototype, 'click', {
        value: function() {
          if (isFileInput(this)) return;
          return originalInputClick.call(this);
        }, writable: false, configurable: false
      });
      if (typeof inputPrototype.showPicker === 'function') {
        const originalShowPicker = inputPrototype.showPicker;
        Object.defineProperty(inputPrototype, 'showPicker', {
          value: function() {
            if (isFileInput(this)) return;
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
      Object.defineProperty(globalThis, '__wavegamesRulesPost', {
        value: post, writable: false, configurable: false, enumerable: false
      });
      try { delete window.webkit.messageHandlers[\(token)]; } catch (_) {}
      Object.defineProperty(Math, 'random', {
        value: () => { throw new Error('Math.random is forbidden in authoritative rules'); },
        writable: false, configurable: false
      });
    })();
    """
  }

  private var rulesBootstrap: String {
    return """
    import * as rules from '/\(entrypoint)';
    Object.defineProperty(globalThis, '__wavegamesRules', {
      value: Object.freeze(rules), writable: false, configurable: false, enumerable: false
    });
    globalThis.__wavegamesRulesPost({type: 'rules.ready'});
    """
  }

  static let rulesDocument = "__runtime/rules.html"
  static let rulesBridge = "__runtime/rules-bridge.js"
  static let rulesBootstrap = "__runtime/rules-bootstrap.mjs"

  private var contentSecurityPolicy: String {
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    + "img-src 'self'; font-src 'self'; "
    + (allowAudio ? "media-src 'self'; " : "media-src 'none'; ")
    + "connect-src 'none'; "
    + "frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  }

  static func javascriptString(_ value: String) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: [value]),
      let encoded = String(data: data, encoding: .utf8)
    else { return "\"\"" }
    return String(encoded.dropFirst().dropLast())
  }

  private static func mimeType(_ url: URL) -> String {
    switch url.pathExtension.lowercased() {
    case "html", "htm": return "text/html"
    case "js", "mjs": return "text/javascript"
    case "css": return "text/css"
    case "json": return "application/json"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "gif": return "image/gif"
    case "webp": return "image/webp"
    case "woff": return "font/woff"
    case "woff2": return "font/woff2"
    case "wav": return "audio/wav"
    case "mp3": return "audio/mpeg"
    case "ogg": return "audio/ogg"
    case "m4a": return "audio/mp4"
    default: return "application/octet-stream"
    }
  }

  private static func isTextMime(_ mime: String) -> Bool {
    mime.hasPrefix("text/") || mime == "application/json" || mime == "image/svg+xml"
  }
}
