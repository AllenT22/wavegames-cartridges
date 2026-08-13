package com.wavegames.wavegame_runtime

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.nio.charset.StandardCharsets

internal object JsonBridge {
    fun encode(value: Any?): String = encodeValue(value).toString()

    fun decodeObject(encoded: String, maximumBytes: Int): Map<String, Any?> {
        require(encoded.toByteArray(StandardCharsets.UTF_8).size <= maximumBytes) {
            "Bridge envelope exceeds $maximumBytes bytes"
        }
        validateNesting(encoded)
        val tokener = JSONTokener(encoded)
        val value = tokener.nextValue()
        require(tokener.nextClean() == '\u0000') { "Bridge envelope has trailing data" }
        require(value is JSONObject) { "Bridge envelope must be an object" }
        return objectToMap(value)
    }

    internal fun validateNesting(encoded: String, maximumDepth: Int = 32) {
        require(maximumDepth > 0) { "Maximum JSON depth must be positive" }
        var depth = 0
        var inString = false
        var escaped = false
        for (character in encoded) {
            if (inString) {
                if (escaped) {
                    escaped = false
                } else if (character == '\\') {
                    escaped = true
                } else if (character == '"') {
                    inString = false
                }
                continue
            }
            when (character) {
                '"' -> inString = true
                '{', '[' -> {
                    depth += 1
                    require(depth <= maximumDepth) {
                        "Bridge envelope exceeds JSON depth $maximumDepth"
                    }
                }
                '}', ']' -> {
                    depth -= 1
                    require(depth >= 0) { "Bridge envelope has invalid JSON nesting" }
                }
            }
        }
        require(!inString && !escaped && depth == 0) {
            "Bridge envelope has invalid JSON nesting"
        }
    }

    fun stringKeyMap(raw: Map<*, *>): Map<String, Any?> {
        val output = linkedMapOf<String, Any?>()
        for ((key, value) in raw) {
            require(key is String) { "JSON object keys must be strings" }
            output[key] = normalize(value)
        }
        return output
    }

    private fun encodeValue(value: Any?): Any = when (value) {
        null -> JSONObject.NULL
        is String, is Boolean, is Int, is Long, is Double, is Float -> value
        is Number -> value.toDouble()
        is Map<*, *> -> JSONObject(stringKeyMap(value).mapValues { encodeValue(it.value) })
        is List<*> -> JSONArray(value.map { encodeValue(it) })
        else -> throw IllegalArgumentException("Value is not JSON-compatible")
    }

    private fun normalize(value: Any?): Any? = when (value) {
        null, is String, is Boolean, is Int, is Long, is Double, is Float -> value
        is Number -> value.toDouble()
        is Map<*, *> -> stringKeyMap(value)
        is List<*> -> value.map { normalize(it) }
        else -> throw IllegalArgumentException("Value is not JSON-compatible")
    }

    private fun objectToMap(value: JSONObject): Map<String, Any?> {
        val output = linkedMapOf<String, Any?>()
        for (key in value.keys()) output[key] = fromJson(value.get(key))
        return output
    }

    private fun fromJson(value: Any?): Any? = when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> objectToMap(value)
        is JSONArray -> List(value.length()) { fromJson(value.get(it)) }
        is String, is Boolean, is Number -> value
        else -> throw IllegalArgumentException("Invalid JSON bridge value")
    }
}
