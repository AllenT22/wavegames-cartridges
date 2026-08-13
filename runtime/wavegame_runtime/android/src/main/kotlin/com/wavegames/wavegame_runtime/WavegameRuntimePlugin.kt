package com.wavegames.wavegame_runtime

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.PluginRegistry
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

class WavegameRuntimePlugin :
    FlutterPlugin,
    ActivityAware,
    MethodChannel.MethodCallHandler,
    PluginRegistry.ActivityResultListener {
    private lateinit var applicationContext: Context
    private lateinit var channel: MethodChannel
    private lateinit var registry: RuntimeRegistry
    private var activityBinding: ActivityPluginBinding? = null
    private var activity: Activity? = null
    private var pendingImportResult: MethodChannel.Result? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        applicationContext = binding.applicationContext
        channel = MethodChannel(binding.binaryMessenger, CONTROL_CHANNEL)
        registry = RuntimeRegistry(applicationContext, channel)
        channel.setMethodCallHandler(this)
        binding.platformViewRegistry.registerViewFactory(
            VIEW_TYPE,
            WavegamePlatformViewFactory(registry),
        )
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
        pendingImportResult?.error("engine_detached", "Flutter engine detached", null)
        pendingImportResult = null
        registry.destroyAll()
    }

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activityBinding = binding
        activity = binding.activity
        binding.addActivityResultListener(this)
    }

    override fun onDetachedFromActivityForConfigChanges() = detachActivity()

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) =
        onAttachedToActivity(binding)

    override fun onDetachedFromActivity() = detachActivity()

    private fun detachActivity() {
        activityBinding?.removeActivityResultListener(this)
        activityBinding = null
        activity = null
        pendingImportResult?.error("activity_detached", "Document picker was interrupted", null)
        pendingImportResult = null
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "pickDocument" -> pickDocument(result)
            "getSupportDirectory" -> getSupportDirectory(result)
            "dispatch" -> registry.dispatch(call.arguments, result)
            "createRules" -> registry.createRules(call.arguments, result)
            "invokeRules" -> registry.invokeRules(call.arguments, result)
            "destroy" -> registry.destroy(call.arguments, result)
            else -> result.notImplemented()
        }
    }

    private fun getSupportDirectory(result: MethodChannel.Result) {
        try {
            val root = File(applicationContext.filesDir, "WaveGames")
            val cartridges = File(root, "cartridges")
            check(cartridges.mkdirs() || cartridges.isDirectory) {
                "Could not create the private cartridge directory"
            }
            result.success(root.canonicalPath)
        } catch (error: Exception) {
            result.error("support_directory_failed", error.message, null)
        }
    }

    private fun pickDocument(result: MethodChannel.Result) {
        val currentActivity = activity
        if (currentActivity == null) {
            result.error("no_activity", "A foreground activity is required", null)
            return
        }
        if (pendingImportResult != null) {
            result.error("picker_busy", "Another document picker is already open", null)
            return
        }
        pendingImportResult = result
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(
                Intent.EXTRA_MIME_TYPES,
                arrayOf("application/zip", "application/octet-stream", "application/x-wavegame"),
            )
        }
        try {
            currentActivity.startActivityForResult(intent, IMPORT_REQUEST_CODE)
        } catch (error: Exception) {
            pendingImportResult = null
            result.error("picker_failed", error.message, null)
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != IMPORT_REQUEST_CODE) return false
        val result = pendingImportResult ?: return true
        pendingImportResult = null
        if (resultCode != Activity.RESULT_OK) {
            result.success(null)
            return true
        }
        val uri = data?.data
        if (uri == null) {
            result.error("missing_document", "The document provider returned no file", null)
            return true
        }
        Thread {
            try {
                val imported = copyImport(uri)
                Handler(Looper.getMainLooper()).post { result.success(imported) }
            } catch (error: Exception) {
                Handler(Looper.getMainLooper()).post {
                    result.error("import_failed", error.message ?: "Could not copy document", null)
                }
            }
        }.start()
        return true
    }

    private fun copyImport(uri: Uri): Map<String, Any> {
        val displayName = queryDisplayName(uri)
        require(displayName.lowercase().endsWith(".wavegame")) {
            "Select a file whose name ends in .wavegame"
        }
        val importDirectory = File(applicationContext.cacheDir, "wavegame-imports")
        check(importDirectory.mkdirs() || importDirectory.isDirectory) {
            "Could not create the private import directory"
        }
        val destination = File(importDirectory, "${UUID.randomUUID()}.wavegame")
        var byteLength = 0L
        try {
            val input = applicationContext.contentResolver.openInputStream(uri)
                ?: error("The selected document is not readable")
            input.use { source ->
                FileOutputStream(destination).use { output ->
                    val buffer = ByteArray(COPY_BUFFER_SIZE)
                    while (true) {
                        val count = source.read(buffer)
                        if (count < 0) break
                        byteLength += count
                        require(byteLength <= MAX_IMPORT_BYTES) {
                            "The selected cartridge exceeds 25 MiB"
                        }
                        output.write(buffer, 0, count)
                    }
                    output.fd.sync()
                }
            }
            require(byteLength > 0) { "The selected cartridge is empty" }
            return mapOf(
                "path" to destination.absolutePath,
                "displayName" to displayName,
                "byteLength" to byteLength,
            )
        } catch (error: Exception) {
            destination.delete()
            throw error
        }
    }

    private fun queryDisplayName(uri: Uri): String {
        var cursor: Cursor? = null
        try {
            cursor = applicationContext.contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null,
            )
            if (cursor != null && cursor.moveToFirst()) {
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0) {
                    val name = cursor.getString(index)
                    if (!name.isNullOrBlank()) return name
                }
            }
        } finally {
            cursor?.close()
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "cartridge.wavegame"
    }

    companion object {
        internal const val CONTROL_CHANNEL = "com.wavegames.wavegame_runtime/control"
        internal const val VIEW_TYPE = "com.wavegames.wavegame_runtime/view"
        private const val IMPORT_REQUEST_CODE = 0x5747
        private const val COPY_BUFFER_SIZE = 64 * 1024
        private const val MAX_IMPORT_BYTES = 25L * 1024L * 1024L
    }
}
