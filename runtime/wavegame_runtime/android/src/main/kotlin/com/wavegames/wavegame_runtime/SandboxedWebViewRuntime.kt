package com.wavegames.wavegame_runtime

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SafeBrowsingResponse
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebViewRenderProcess
import android.webkit.WebViewRenderProcessClient
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.concurrent.atomic.AtomicBoolean

internal class SandboxedWebViewRuntime private constructor(
    context: Context,
    private val registry: RuntimeRegistry,
    val runtimeId: String,
    private val channelToken: String,
    installedDirectory: String,
    private val entrypoint: String,
    private val maximumEnvelopeBytes: Int,
    private val mode: Mode,
    private val watchdogMilliseconds: Int,
    private val allowAudio: Boolean,
) {
    enum class Mode { VISIBLE, RULES }

    private val resourceRoot = SafeResourceRoot(installedDirectory)
    private val handler = Handler(Looper.getMainLooper())
    private val pendingRules = mutableMapOf<String, Runnable>()
    private val bridgeIngress = BridgeIngressGate(
        maximumBytes = maximumEnvelopeBytes,
        maximumPending = MAXIMUM_QUEUED_BRIDGE_MESSAGES,
    )
    private val bridgeForward = BridgeForwardGate(
        maximumPending = MAXIMUM_PENDING_FLUTTER_EVENTS,
        reservedCriticalSlots = 1,
        burst = BRIDGE_EVENT_BURST,
        refillPerSecond = BRIDGE_EVENTS_PER_SECOND,
        clockMilliseconds = { SystemClock.elapsedRealtime() },
    )
    private val bridgeAbuseSignaled = AtomicBoolean(false)
    @Volatile private var destroyed = false

    val webView: WebView = WebView(context.applicationContext)

    init {
        require(maximumEnvelopeBytes in 1024..MAXIMUM_ENVELOPE_BYTES) {
            "Invalid maximum envelope size"
        }
        require(SafeResourceRoot.isSafeRelativePath(entrypoint)) {
            "Entrypoint is not a safe relative path"
        }
        require(channelToken.matches(Regex("[A-Za-z_][A-Za-z0-9_]{15,128}"))) {
            "Channel token is invalid"
        }
        if (mode == Mode.RULES) {
            require(watchdogMilliseconds in 1..250) { "Rules watchdog exceeds 250ms" }
        }
        configureWebView()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        with(webView.settings) {
            javaScriptEnabled = true
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            allowFileAccess = false
            allowContentAccess = false
            domStorageEnabled = false
            databaseEnabled = false
            cacheMode = WebSettings.LOAD_NO_CACHE
            blockNetworkLoads = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            saveFormData = false
            loadsImagesAutomatically = true
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) safeBrowsingEnabled = true
        }
        webView.setBackgroundColor(android.graphics.Color.TRANSPARENT)
        webView.clearCache(true)
        webView.clearHistory()
        webView.clearFormData()
        CookieManager.getInstance().setAcceptCookie(false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        webView.setDownloadListener(DownloadListener { _, _, _, _, _ ->
            emitLifecycle("blockedDownload", null)
        })
        webView.webChromeClient = LockedChromeClient()
        webView.webViewClient = LockedWebViewClient()
        webView.addJavascriptInterface(NativeBridge(), channelToken)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            webView.setWebViewRenderProcessClient(
                object : WebViewRenderProcessClient() {
                    override fun onRenderProcessResponsive(
                        view: WebView,
                        renderer: WebViewRenderProcess?,
                    ) = Unit

                    override fun onRenderProcessUnresponsive(
                        view: WebView,
                        renderer: WebViewRenderProcess?,
                    ) {
                        destroy("rendererUnresponsive", "Web content stopped responding", notify = true)
                    }
                },
            )
        }
    }

    fun startVisible() {
        check(mode == Mode.VISIBLE) { "Runtime is not visible" }
        webView.loadUrl(internalUrl(entrypoint))
    }

    fun startRules() {
        check(mode == Mode.RULES) { "Runtime is not a rules runtime" }
        webView.loadUrl(internalUrl(RULES_DOCUMENT))
    }

    fun dispatch(envelope: Map<String, Any?>) {
        check(mode == Mode.VISIBLE && !destroyed) { "Visible runtime is not active" }
        val encoded = JsonBridge.encode(envelope)
        require(encoded.toByteArray(StandardCharsets.UTF_8).size <= maximumEnvelopeBytes) {
            "Host envelope exceeds $maximumEnvelopeBytes bytes"
        }
        val base64 = Base64.getEncoder().encodeToString(encoded.toByteArray(StandardCharsets.UTF_8))
        webView.evaluateJavascript(
            "window.__wavegamesReceiveBase64 && window.__wavegamesReceiveBase64('$base64');",
            null,
        )
    }

    fun invokeRules(requestId: String, function: String, argument: Any?) {
        check(mode == Mode.RULES && !destroyed) { "Rules runtime is not active" }
        require(requestId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "Invalid request ID" }
        require(function in ALLOWED_RULES_FUNCTIONS) { "Unsupported rules function" }
        check(!pendingRules.containsKey(requestId)) { "Rules request is already pending" }
        check(pendingRules.size < MAXIMUM_PENDING_RULES_REQUESTS) {
            "Too many rules requests are pending"
        }
        val argumentJson = JsonBridge.encode(argument)
        require(argumentJson.toByteArray(StandardCharsets.UTF_8).size <= maximumEnvelopeBytes) {
            "Rules argument exceeds $maximumEnvelopeBytes bytes"
        }
        val script = rulesInvocationScript(requestId, function, argumentJson)
        val timeout = Runnable {
            if (pendingRules.remove(requestId) != null && !destroyed) {
                forwardToFlutter(
                    mapOf("type" to "rules.timeout", "requestId" to requestId),
                )
                destroy("rulesTimeout", "Rules call exceeded ${watchdogMilliseconds}ms", notify = false)
            }
        }
        pendingRules[requestId] = timeout
        handler.postDelayed(timeout, watchdogMilliseconds.toLong())
        webView.evaluateJavascript(script, null)
    }

    fun destroy(state: String, detail: String?, notify: Boolean) {
        if (destroyed) return
        destroyed = true
        for (timeout in pendingRules.values) handler.removeCallbacks(timeout)
        pendingRules.clear()
        if (notify) emitLifecycle(state, detail, critical = true)
        webView.stopLoading()
        webView.removeJavascriptInterface(channelToken)
        webView.webChromeClient = null
        webView.webViewClient = WebViewClient()
        webView.loadUrl("about:blank")
        webView.clearCache(true)
        webView.clearHistory()
        webView.removeAllViews()
        webView.destroy()
        registry.runtimeDestroyed(runtimeId, this)
    }

    private fun emitLifecycle(state: String, detail: String?, critical: Boolean = false) {
        forwardToFlutter(
            mapOf(
                "type" to "lifecycle",
                "payload" to mapOf("state" to state, "detail" to detail),
            ),
            critical = critical,
        )
    }

    private fun forwardToFlutter(
        envelope: Map<String, Any?>,
        critical: Boolean = false,
    ) {
        if (destroyed && !critical) return
        if (!bridgeForward.tryAcquire(critical)) {
            if (!critical) failBridgeFlood("Bridge event rate or pending limit exceeded")
            return
        }
        registry.emit(runtimeId, envelope) {
            handler.post { bridgeForward.release() }
        }
    }

    private fun failBridgeFlood(detail: String) {
        if (destroyed) return
        destroy("bridgeFlood", detail, notify = true)
    }

    private fun signalBridgeAbuse(rejection: BridgeIngressRejection) {
        if (!bridgeAbuseSignaled.compareAndSet(false, true)) return
        val detail = when (rejection) {
            BridgeIngressRejection.TOO_LARGE ->
                "Bridge envelope exceeds $maximumEnvelopeBytes bytes"
            BridgeIngressRejection.OVERLOADED ->
                "Bridge message queue limit exceeded"
        }
        handler.post { failBridgeFlood(detail) }
    }

    private fun handleBridgeMessage(encoded: String) {
        if (destroyed) return
        try {
            val envelope = JsonBridge.decodeObject(encoded, maximumEnvelopeBytes)
            val type = envelope["type"] as? String
                ?: throw IllegalArgumentException("Bridge event has no type")
            if (mode == Mode.VISIBLE) {
                require(type in ALLOWED_VISIBLE_EVENTS) { "Unsupported UI bridge event" }
                forwardToFlutter(envelope)
                return
            }
            require(type in ALLOWED_RULES_EVENTS) { "Unsupported rules bridge event" }
            if (type == "rules.result" || type == "rules.error") {
                val requestId = envelope["requestId"]?.toString()
                    ?: throw IllegalArgumentException("Rules response has no request ID")
                val timeout = pendingRules.remove(requestId) ?: return
                handler.removeCallbacks(timeout)
            }
            forwardToFlutter(envelope)
        } catch (error: Exception) {
            emitLifecycle("bridgeViolation", error.message)
            if (mode == Mode.RULES) destroy("bridgeViolation", error.message, notify = false)
        }
    }

    private fun rulesInvocationScript(requestId: String, function: String, argumentJson: String): String {
        val request = org.json.JSONObject.quote(requestId)
        val functionName = org.json.JSONObject.quote(function)
        return """
            (() => {
              const requestId = $request;
              const post = globalThis.__wavegamesRulesPost;
              const fail = (error) => post({
                type: 'rules.error', requestId,
                message: String(error && error.message ? error.message : error).slice(0, 4096)
              });
              Promise.resolve().then(async () => {
                const fn = globalThis.__wavegamesRules && globalThis.__wavegamesRules[$functionName];
                if (typeof fn !== 'function') throw new Error('Rules function is not exported');
                const input = $argumentJson;
                let argument = input;
                let randomCounter = null;
                if ($functionName === 'view') {
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
        """.trimIndent()
    }

    private fun internalUrl(relative: String) = "${SafeResourceRoot.SCHEME}://${SafeResourceRoot.HOST}/$relative"

    private fun isAllowedInternalUri(uri: Uri): Boolean {
        if (uri.scheme != SafeResourceRoot.SCHEME ||
            uri.host != SafeResourceRoot.HOST ||
            uri.query != null ||
            uri.fragment != null
        ) {
            return false
        }
        val relative = Uri.decode(uri.encodedPath ?: "").removePrefix("/")
        if (mode == Mode.RULES && relative in setOf(RULES_DOCUMENT, RULES_BRIDGE, RULES_BOOTSTRAP)) {
            return true
        }
        if (mode == Mode.VISIBLE && relative == UI_BOOTSTRAP) return true
        if (relative.startsWith("__runtime/")) return false
        return resourceRoot.resolveWavegameUri(uri) != null
    }

    private fun responseFor(uri: Uri): WebResourceResponse {
        if (uri.scheme != SafeResourceRoot.SCHEME ||
            uri.host != SafeResourceRoot.HOST ||
            uri.query != null ||
            uri.fragment != null
        ) {
            return deniedResponse()
        }
        val relative = Uri.decode(uri.encodedPath ?: "").removePrefix("/")
        if (mode == Mode.RULES && relative == RULES_DOCUMENT) {
            return memoryResponse("text/html", rulesDocument())
        }
        if (mode == Mode.RULES && relative == RULES_BOOTSTRAP) {
            return memoryResponse("text/javascript", rulesBootstrap())
        }
        if (mode == Mode.RULES && relative == RULES_BRIDGE) {
            return memoryResponse("text/javascript", rulesBridge())
        }
        if (mode == Mode.VISIBLE && relative == UI_BOOTSTRAP) {
            return memoryResponse("text/javascript", visibleBootstrap())
        }
        if (relative.startsWith("__runtime/")) return deniedResponse()
        val file = resourceRoot.resolveWavegameUri(uri) ?: return deniedResponse()
        if (mode == Mode.VISIBLE && relative == entrypoint) {
            return visibleEntrypointResponse(file)
        }
        return WebResourceResponse(
            mimeType(file),
            if (isTextMime(mimeType(file))) "UTF-8" else null,
            200,
            "OK",
            securityHeaders(),
            file.inputStream().buffered(),
        )
    }

    private fun memoryResponse(mime: String, value: String): WebResourceResponse =
        WebResourceResponse(
            mime,
            "UTF-8",
            200,
            "OK",
            securityHeaders(),
            ByteArrayInputStream(value.toByteArray(StandardCharsets.UTF_8)),
        )

    private fun visibleEntrypointResponse(file: File): WebResourceResponse {
        if (mimeType(file) != "text/html" || file.length() > MAXIMUM_ENTRY_HTML_BYTES) {
            return deniedResponse()
        }
        val html = try {
            val bytes = file.readBytes()
            StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
        } catch (_: Exception) {
            return deniedResponse()
        }
        val injected = try {
            injectVisibleBootstrap(html)
        } catch (_: Exception) {
            return deniedResponse()
        }
        return memoryResponse("text/html", injected)
    }

    private fun deniedResponse(): WebResourceResponse = WebResourceResponse(
        "text/plain",
        "UTF-8",
        403,
        "Forbidden",
        securityHeaders(),
        ByteArrayInputStream(ByteArray(0)),
    )

    private fun securityHeaders() = mapOf(
        "Cache-Control" to "no-store, max-age=0",
        "Content-Security-Policy" to contentSecurityPolicy,
        "Cross-Origin-Resource-Policy" to "same-origin",
        "Referrer-Policy" to "no-referrer",
        "X-Content-Type-Options" to "nosniff",
        "X-Frame-Options" to "DENY",
    )

    private fun rulesDocument() = """
        <!doctype html><html><head><meta charset="utf-8"></head>
        <body><script src="/$RULES_BRIDGE"></script><script type="module" src="/$RULES_BOOTSTRAP"></script></body></html>
    """.trimIndent()

    private fun rulesBridge(): String {
        val token = org.json.JSONObject.quote(channelToken)
        return """
            (() => {
              const native = window[$token];
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
                if (encoded.length > $maximumEnvelopeBytes ||
                    encodeText(encoded).byteLength > $maximumEnvelopeBytes) {
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
              $DETERMINISTIC_DATE_GUARD
              $DETERMINISTIC_INTL_TEMPORAL_GUARD
              $CLIPBOARD_GUARD
              Object.defineProperty(globalThis, '__wavegamesRulesPost', {
                value: post, writable: false, configurable: false, enumerable: false
              });
              try { delete window[$token]; } catch (_) {}
              Object.defineProperty(Math, 'random', {
                value: () => { throw new Error('Math.random is forbidden in authoritative rules'); },
                writable: false, configurable: false
              });
            })();
        """.trimIndent()
    }

    private fun rulesBootstrap() = """
        import * as rules from '/$entrypoint';
        Object.defineProperty(globalThis, '__wavegamesRules', {
          value: Object.freeze(rules), writable: false, configurable: false, enumerable: false
        });
        globalThis.__wavegamesRulesPost({type: 'rules.ready'});
    """.trimIndent()

    private fun visibleBootstrap(): String {
        val token = org.json.JSONObject.quote(channelToken)
        return """
        (() => {
          if (window.WaveGames) return;
          const native = window[$token];
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
            if (encoded.length > $maximumEnvelopeBytes ||
                encodeText(encoded).byteLength > $maximumEnvelopeBytes) {
              throw new RangeError('Bridge envelope is too large');
            }
            native.postMessage(encoded);
          };
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
          try { delete window[$token]; } catch (_) {}
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
        """.trimIndent()
    }

    private inner class NativeBridge {
        @JavascriptInterface
        fun postMessage(encoded: String) {
            val rejection = bridgeIngress.tryAcquire(encoded)
            if (rejection != null) {
                signalBridgeAbuse(rejection)
                return
            }
            handler.post {
                try {
                    handleBridgeMessage(encoded)
                } finally {
                    bridgeIngress.release()
                }
            }
        }
    }

    private inner class LockedChromeClient : WebChromeClient() {
        override fun onCreateWindow(
            view: WebView?,
            isDialog: Boolean,
            isUserGesture: Boolean,
            resultMsg: android.os.Message?,
        ) = false

        override fun onShowFileChooser(
            webView: WebView?,
            filePathCallback: ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?,
        ): Boolean {
            filePathCallback?.onReceiveValue(null)
            emitLifecycle("blockedFileChooser", null)
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest?) {
            request?.deny()
            emitLifecycle("blockedPermission", null)
        }

        override fun onGeolocationPermissionsShowPrompt(
            origin: String?,
            callback: GeolocationPermissions.Callback?,
        ) {
            callback?.invoke(origin, false, false)
            emitLifecycle("blockedGeolocation", null)
        }
    }

    private inner class LockedWebViewClient : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse {
            return if (request == null) deniedResponse() else responseFor(request.url)
        }

        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            val uri = request?.url ?: return true
            return !isAllowedInternalUri(uri)
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            if (url == null || !url.startsWith("${SafeResourceRoot.SCHEME}://${SafeResourceRoot.HOST}/")) {
                view?.stopLoading()
            }
        }

        override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
            destroy(
                "rendererCrashed",
                if (detail?.didCrash() == true) "Web content process crashed" else "Web content process was terminated",
                notify = true,
            )
            return true
        }

        override fun onSafeBrowsingHit(
            view: WebView?,
            request: WebResourceRequest?,
            threatType: Int,
            callback: SafeBrowsingResponse?,
        ) {
            callback?.backToSafety(true)
            emitLifecycle("safeBrowsingBlocked", null)
        }
    }

    companion object {
        private const val MAXIMUM_ENVELOPE_BYTES = 128 * 1024
        private const val MAXIMUM_QUEUED_BRIDGE_MESSAGES = 32
        private const val MAXIMUM_PENDING_FLUTTER_EVENTS = 32
        private const val MAXIMUM_PENDING_RULES_REQUESTS = 8
        private const val BRIDGE_EVENT_BURST = 64
        private const val BRIDGE_EVENTS_PER_SECOND = 32.0
        private const val MAXIMUM_ENTRY_HTML_BYTES = 2L * 1024L * 1024L
        private const val RULES_DOCUMENT = "__runtime/rules.html"
        private const val RULES_BRIDGE = "__runtime/rules-bridge.js"
        private const val RULES_BOOTSTRAP = "__runtime/rules-bootstrap.mjs"
        private const val UI_BOOTSTRAP = "__runtime/ui-bootstrap.js"
        private const val UI_BOOTSTRAP_TAG = "<script src=\"/$UI_BOOTSTRAP\"></script>"
        private val ALLOWED_VISIBLE_EVENTS = setOf(
            "ready", "action", "storage.get", "storage.set", "storage.remove", "log", "lifecycle",
        )
        private val ALLOWED_RULES_EVENTS = setOf("rules.ready", "rules.result", "rules.error")
        private val ALLOWED_RULES_FUNCTIONS = setOf("create", "reduce", "view")
        private const val CONTENT_SECURITY_POLICY_PREFIX =
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
                "img-src 'self'; font-src 'self'; "
        private const val CONTENT_SECURITY_POLICY_SUFFIX =
            "connect-src 'none'; " +
                "frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

        internal val DETERMINISTIC_DATE_GUARD = """
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
        """.trimIndent()

        internal val DETERMINISTIC_INTL_TEMPORAL_GUARD = """
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
        """.trimIndent()

        internal val BRIDGE_TOKEN_BUCKET_INTRINSICS = """
            const bridgeMin = Math.min.bind(Math);
            const bridgeMax = Math.max.bind(Math);
        """.trimIndent()

        internal val CLIPBOARD_GUARD = """
            try { Object.defineProperty(navigator, 'clipboard', {
              get: () => undefined, configurable: false
            }); } catch (_) {}
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
            const guardedOriginalExecCommand = document.execCommand &&
              document.execCommand.bind(document);
            if (guardedOriginalExecCommand) {
              const guardedExecCommand = (command, ...args) =>
                ['copy', 'cut', 'paste'].includes(String(command).toLowerCase())
                  ? false : guardedOriginalExecCommand(command, ...args);
              try { Object.defineProperty(Document.prototype, 'execCommand', {
                value: guardedExecCommand, writable: false, configurable: false
              }); } catch (_) {}
              try { Object.defineProperty(document, 'execCommand', {
                value: guardedExecCommand, writable: false, configurable: false
              }); } catch (_) {}
            }
        """.trimIndent()

        fun createVisible(
            context: Context,
            registry: RuntimeRegistry,
            runtimeId: String,
            channelToken: String,
            installedDirectory: String,
            entrypoint: String,
            maximumEnvelopeBytes: Int,
            allowAudio: Boolean,
        ) = SandboxedWebViewRuntime(
            context,
            registry,
            runtimeId,
            channelToken,
            installedDirectory,
            entrypoint,
            maximumEnvelopeBytes,
            Mode.VISIBLE,
            250,
            allowAudio,
        )

        fun createRules(
            context: Context,
            registry: RuntimeRegistry,
            runtimeId: String,
            channelToken: String,
            installedDirectory: String,
            entrypoint: String,
            maximumEnvelopeBytes: Int,
            watchdogMilliseconds: Int,
        ) = SandboxedWebViewRuntime(
            context,
            registry,
            runtimeId,
            channelToken,
            installedDirectory,
            entrypoint,
            maximumEnvelopeBytes,
            Mode.RULES,
            watchdogMilliseconds,
            false,
        )

        private fun mimeType(file: File): String = when (file.extension.lowercase()) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "webp" -> "image/webp"
            "woff" -> "font/woff"
            "woff2" -> "font/woff2"
            "wav" -> "audio/wav"
            "mp3" -> "audio/mpeg"
            "ogg" -> "audio/ogg"
            "m4a" -> "audio/mp4"
            else -> "application/octet-stream"
        }

        private fun isTextMime(mime: String) =
            mime.startsWith("text/") || mime == "application/json" || mime == "image/svg+xml"

        internal fun injectVisibleBootstrap(html: String): String {
            require(!html.contains(UI_BOOTSTRAP_TAG)) { "Entrypoint contains reserved bootstrap" }
            val head = Regex("<head\\s*>", RegexOption.IGNORE_CASE).find(html)
                ?: throw IllegalArgumentException("Entrypoint HTML must contain a head element")
            val prefix = html.substring(0, head.range.first)
            val permittedPrefix = prefix
                .replace(Regex("<!doctype\\s+html\\s*>", RegexOption.IGNORE_CASE), "")
                .replace(Regex("<html(?:\\s[^>]*)?>", RegexOption.IGNORE_CASE), "")
            require(permittedPrefix.isBlank()) {
                "Entrypoint contains ambiguous markup before its head element"
            }
            val firstScript = Regex("<script(?:\\s|>)", RegexOption.IGNORE_CASE).find(html)
            require(firstScript == null || firstScript.range.first > head.range.last) {
                "Entrypoint contains script before its head element"
            }
            val insertion = head.range.last + 1
            return html.substring(0, insertion) + UI_BOOTSTRAP_TAG + html.substring(insertion)
        }
    }

    private val contentSecurityPolicy: String
        get() = CONTENT_SECURITY_POLICY_PREFIX +
            (if (mode == Mode.VISIBLE && allowAudio) "media-src 'self'; " else "media-src 'none'; ") +
            CONTENT_SECURITY_POLICY_SUFFIX
}
