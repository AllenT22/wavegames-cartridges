package com.wavegames.wavegame_runtime

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class SafeResourceRootTest {
    @Test
    fun acceptsNormalizedRelativePaths() {
        assertTrue(SafeResourceRoot.isSafeRelativePath("ui/index.html"))
        assertTrue(SafeResourceRoot.isSafeRelativePath("assets/board.png"))
    }

    @Test
    fun rejectsTraversalAndAmbiguousPaths() {
        assertFalse(SafeResourceRoot.isSafeRelativePath("../secret"))
        assertFalse(SafeResourceRoot.isSafeRelativePath("ui/../secret"))
        assertFalse(SafeResourceRoot.isSafeRelativePath("ui//index.html"))
        assertFalse(SafeResourceRoot.isSafeRelativePath("ui\\index.html"))
        assertFalse(SafeResourceRoot.isSafeRelativePath("/ui/index.html"))
    }

    @Test
    fun injectsRuntimeBeforeEveryCartridgeScript() {
        val html = "<!doctype html><html><head><script type=\"module\" src=\"app.mjs\"></script></head></html>"

        val injected = SandboxedWebViewRuntime.injectVisibleBootstrap(html)

        val bootstrap = injected.indexOf("/__runtime/ui-bootstrap.js")
        val cartridge = injected.indexOf("app.mjs")
        assertTrue(bootstrap >= 0)
        assertTrue(bootstrap < cartridge)
        assertTrue(injected.startsWith("<!doctype html>"))
    }

    @Test
    fun refusesAmbiguousEntrypointWithoutHead() {
        val result = runCatching {
            SandboxedWebViewRuntime.injectVisibleBootstrap(
                "<!doctype html><script type=\"module\" src=\"app.mjs\"></script>",
            )
        }

        assertTrue(result.isFailure)
    }

    @Test
    fun refusesHeadMarkupHiddenInsideAComment() {
        val result = runCatching {
            SandboxedWebViewRuntime.injectVisibleBootstrap(
                "<!doctype html><!-- <head> --><html><head></head></html>",
            )
        }

        assertTrue(result.isFailure)
    }

    @Test
    fun refusesQuotedTagTerminatorInsideHeadAttribute() {
        val result = runCatching {
            SandboxedWebViewRuntime.injectVisibleBootstrap(
                "<!doctype html><html><head data=\" > \" ><script src=\"app.mjs\"></script></head></html>",
            )
        }

        assertTrue(result.isFailure)
    }

    @Test
    fun bridgeRejectsPathologicallyDeepJsonBeforeParsing() {
        val deeplyNested = "{" + "\"value\":" + "[".repeat(33) + "0" + "]".repeat(33) + "}"

        assertFailsWith<IllegalArgumentException> {
            JsonBridge.decodeObject(deeplyNested, 128 * 1024)
        }
        JsonBridge.validateNesting("""{"value":"[[{{text"}""")
    }

    @Test
    fun rulesDateGuardRejectsWallClockButKeepsExplicitConstruction() {
        val guard = SandboxedWebViewRuntime.DETERMINISTIC_DATE_GUARD

        assertTrue(guard.contains("args.length === 0 || !new.target"))
        assertTrue(guard.contains("Reflect.construct.bind(Reflect)"))
        assertTrue(guard.contains("deterministicConstruct(OriginalDate, args, new.target)"))
        assertTrue(guard.contains("OriginalDate.prototype, 'constructor'"))
        assertFalse(guard.contains("Object.setPrototypeOf(DeterministicDate, OriginalDate)"))
        assertTrue(guard.contains("value: nondeterministic"))
    }

    @Test
    fun rulesIntlAndTemporalGuardRejectsImplicitClockValues() {
        val guard = SandboxedWebViewRuntime.DETERMINISTIC_INTL_TEMPORAL_GUARD

        assertTrue(guard.contains("arguments.length === 0 || value === undefined"))
        assertTrue(guard.contains("Reflect.apply.bind(Reflect)"))
        assertTrue(guard.contains("deterministicApply(format, undefined, arguments)"))
        assertTrue(guard.contains("deterministicApply(formatToParts, this, arguments)"))
        assertTrue(guard.contains("globalThis.Temporal, 'Now'"))
    }

    @Test
    fun bootstrapCapturesRateLimitIntrinsicsBeforeCartridgeCode() {
        val source = SandboxedWebViewRuntime.BRIDGE_TOKEN_BUCKET_INTRINSICS

        assertTrue(source.contains("const bridgeMin = Math.min.bind(Math)"))
        assertTrue(source.contains("const bridgeMax = Math.max.bind(Math)"))
    }

    @Test
    fun rulesBootstrapIncludesCompleteClipboardGuard() {
        val guard = SandboxedWebViewRuntime.CLIPBOARD_GUARD

        assertTrue(guard.contains("Navigator.prototype, 'clipboard'"))
        assertTrue(guard.contains("Clipboard.prototype, name"))
        assertTrue(guard.contains("Document.prototype, 'execCommand'"))
        assertTrue(guard.contains("['copy', 'cut', 'paste']"))
    }
}
