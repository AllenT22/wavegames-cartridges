package com.wavegames.wavegame_runtime

import android.content.Context
import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.MethodChannel

internal class RuntimeRegistry(
    private val context: Context,
    private val channel: MethodChannel,
) {
    private val runtimes = mutableMapOf<String, SandboxedWebViewRuntime>()
    private val mainHandler = Handler(Looper.getMainLooper())

    fun register(runtime: SandboxedWebViewRuntime) {
        check(!runtimes.containsKey(runtime.runtimeId)) { "Runtime ID is already active" }
        runtimes[runtime.runtimeId] = runtime
    }

    fun emit(
        runtimeId: String,
        envelope: Map<String, Any?>,
        completion: () -> Unit = {},
    ) {
        val invoke = {
            try {
                channel.invokeMethod(
                    "runtimeEvent",
                    mapOf("runtimeId" to runtimeId, "envelope" to envelope),
                    object : MethodChannel.Result {
                        override fun success(result: Any?) = completion()

                        override fun error(
                            errorCode: String,
                            errorMessage: String?,
                            errorDetails: Any?,
                        ) = completion()

                        override fun notImplemented() = completion()
                    },
                )
            } catch (_: Exception) {
                completion()
            }
        }
        if (Looper.myLooper() == Looper.getMainLooper()) invoke() else mainHandler.post(invoke)
    }

    fun runtimeDestroyed(runtimeId: String, runtime: SandboxedWebViewRuntime) {
        if (runtimes[runtimeId] === runtime) runtimes.remove(runtimeId)
    }

    fun dispatch(arguments: Any?, result: MethodChannel.Result) = onMain(result) {
        val args = argumentMap(arguments)
        val runtime = requireRuntime(args)
        val envelope = args["envelope"] as? Map<*, *>
            ?: throw IllegalArgumentException("Envelope is missing")
        runtime.dispatch(JsonBridge.stringKeyMap(envelope))
        null
    }

    fun createRules(arguments: Any?, result: MethodChannel.Result) = onMain(result) {
        val args = argumentMap(arguments)
        val runtimeId = requiredString(args, "runtimeId")
        check(!runtimes.containsKey(runtimeId)) { "Runtime ID is already active" }
        val runtime = SandboxedWebViewRuntime.createRules(
            context = context,
            registry = this,
            runtimeId = runtimeId,
            channelToken = requiredString(args, "channelToken"),
            installedDirectory = requiredString(args, "installedDirectory"),
            entrypoint = requiredString(args, "entrypoint"),
            maximumEnvelopeBytes = requiredInt(args, "maximumEnvelopeBytes"),
            watchdogMilliseconds = requiredInt(args, "watchdogMilliseconds"),
        )
        register(runtime)
        runtime.startRules()
        null
    }

    fun invokeRules(arguments: Any?, result: MethodChannel.Result) = onMain(result) {
        val args = argumentMap(arguments)
        val runtime = requireRuntime(args)
        runtime.invokeRules(
            requestId = requiredString(args, "requestId"),
            function = requiredString(args, "function"),
            argument = args["argument"],
        )
        null
    }

    fun destroy(arguments: Any?, result: MethodChannel.Result) = onMain(result) {
        val args = argumentMap(arguments)
        val runtimeId = requiredString(args, "runtimeId")
        runtimes.remove(runtimeId)?.destroy("disposed", null, notify = false)
        null
    }

    fun destroyAll() {
        val active = runtimes.values.toList()
        runtimes.clear()
        mainHandler.post { active.forEach { it.destroy("engineDetached", null, notify = false) } }
    }

    private fun onMain(result: MethodChannel.Result, operation: () -> Any?) {
        mainHandler.post {
            try {
                result.success(operation())
            } catch (error: Exception) {
                result.error("runtime_error", error.message ?: "Runtime operation failed", null)
            }
        }
    }

    private fun requireRuntime(args: Map<String, Any?>): SandboxedWebViewRuntime {
        val runtimeId = requiredString(args, "runtimeId")
        return runtimes[runtimeId] ?: throw IllegalStateException("Runtime is not active")
    }

    companion object {
        fun argumentMap(arguments: Any?): Map<String, Any?> {
            val raw = arguments as? Map<*, *>
                ?: throw IllegalArgumentException("Arguments must be a map")
            return JsonBridge.stringKeyMap(raw)
        }

        fun requiredString(args: Map<String, Any?>, key: String): String {
            val value = args[key] as? String
            require(!value.isNullOrEmpty()) { "$key is missing" }
            return value
        }

        fun requiredInt(args: Map<String, Any?>, key: String): Int {
            val value = args[key] as? Number ?: throw IllegalArgumentException("$key is missing")
            return value.toInt()
        }
    }
}
