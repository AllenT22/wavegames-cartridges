package com.wavegames.wavegame_runtime

import android.content.Context
import io.flutter.plugin.common.StandardMessageCodec
import io.flutter.plugin.platform.PlatformView
import io.flutter.plugin.platform.PlatformViewFactory

internal class WavegamePlatformViewFactory(
    private val registry: RuntimeRegistry,
) : PlatformViewFactory(StandardMessageCodec.INSTANCE) {
    override fun create(context: Context, viewId: Int, args: Any?): PlatformView {
        val values = RuntimeRegistry.argumentMap(args)
        val runtime = SandboxedWebViewRuntime.createVisible(
            context = context,
            registry = registry,
            runtimeId = RuntimeRegistry.requiredString(values, "runtimeId"),
            channelToken = RuntimeRegistry.requiredString(values, "channelToken"),
            installedDirectory = RuntimeRegistry.requiredString(values, "installedDirectory"),
            entrypoint = RuntimeRegistry.requiredString(values, "entrypoint"),
            maximumEnvelopeBytes = RuntimeRegistry.requiredInt(values, "maximumEnvelopeBytes"),
            allowAudio = values["allowAudio"] as? Boolean ?: false,
        )
        registry.register(runtime)
        runtime.startVisible()
        return WavegamePlatformView(runtime)
    }
}

private class WavegamePlatformView(
    private val runtime: SandboxedWebViewRuntime,
) : PlatformView {
    override fun getView() = runtime.webView

    override fun dispose() {
        runtime.destroy("disposed", null, notify = false)
    }
}
