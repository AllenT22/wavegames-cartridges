package com.wavegames.wavegame_runtime

import android.net.Uri
import java.io.File
import java.nio.file.Files

internal class SafeResourceRoot(rootPath: String) {
    private val root: File

    init {
        require(rootPath.startsWith('/')) { "Installed directory must be absolute" }
        val requested = File(rootPath)
        require(requested.exists() && requested.isDirectory) {
            "Installed directory does not exist"
        }
        require(!Files.isSymbolicLink(requested.toPath())) {
            "Installed directory may not be a symbolic link"
        }
        root = requested.canonicalFile
    }

    fun resolveRelative(relativePath: String): File? {
        val normalized = relativePath.removePrefix("/")
        if (!isSafeRelativePath(normalized)) return null
        val segments = normalized.split('/')
        var cursor = root
        for (segment in segments) {
            cursor = File(cursor, segment)
            if (Files.isSymbolicLink(cursor.toPath())) return null
        }
        val candidate = try {
            cursor.canonicalFile
        } catch (_: Exception) {
            return null
        }
        if (!candidate.path.startsWith(root.path + File.separator)) return null
        if (!candidate.isFile || Files.isSymbolicLink(candidate.toPath())) return null
        return candidate
    }

    fun resolveWavegameUri(uri: Uri): File? {
        if (uri.scheme != SCHEME || uri.host != HOST) return null
        val encodedPath = uri.encodedPath ?: return null
        val decoded = try {
            Uri.decode(encodedPath)
        } catch (_: Exception) {
            return null
        }
        return resolveRelative(decoded)
    }

    companion object {
        const val SCHEME = "wavegame"
        const val HOST = "cartridge"

        fun isSafeRelativePath(value: String): Boolean {
            if (value.isEmpty() || value.startsWith('/') || value.contains('\\') || value.contains('\u0000')) {
                return false
            }
            return value.split('/').none { it.isEmpty() || it == "." || it == ".." }
        }
    }
}
