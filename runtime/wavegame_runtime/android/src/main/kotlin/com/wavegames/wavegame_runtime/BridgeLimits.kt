package com.wavegames.wavegame_runtime

import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.min

internal enum class BridgeIngressRejection {
    TOO_LARGE,
    OVERLOADED,
}

/**
 * Bounds strings captured by the JavaScript-interface thread before they are
 * posted to the main thread. The UTF-16 check avoids encoding an already
 * oversized value, while the UTF-8 check enforces the wire contract exactly.
 */
internal class BridgeIngressGate(
    private val maximumBytes: Int,
    private val maximumPending: Int,
) {
    private val pending = AtomicInteger(0)

    init {
        require(maximumBytes > 0)
        require(maximumPending > 0)
    }

    fun tryAcquire(encoded: String): BridgeIngressRejection? {
        if (encoded.length > maximumBytes) return BridgeIngressRejection.TOO_LARGE
        if (encoded.toByteArray(StandardCharsets.UTF_8).size > maximumBytes) {
            return BridgeIngressRejection.TOO_LARGE
        }
        while (true) {
            val current = pending.get()
            if (current >= maximumPending) return BridgeIngressRejection.OVERLOADED
            if (pending.compareAndSet(current, current + 1)) return null
        }
    }

    fun release() {
        check(pending.decrementAndGet() >= 0) { "Bridge ingress gate released without an acquisition" }
    }

    internal val pendingCount: Int
        get() = pending.get()
}

/**
 * A per-runtime pending cap plus token bucket for native-to-Flutter events.
 * One pending slot is reserved for a terminal lifecycle notice.
 */
internal class BridgeForwardGate(
    private val maximumPending: Int,
    private val reservedCriticalSlots: Int,
    burst: Int,
    private val refillPerSecond: Double,
    private val clockMilliseconds: () -> Long,
) {
    private val maximumTokens = burst.toDouble()
    private var availableTokens = maximumTokens
    private var lastRefillMilliseconds = clockMilliseconds()
    private var pending = 0

    init {
        require(maximumPending > 0)
        require(reservedCriticalSlots in 0 until maximumPending)
        require(burst > 0)
        require(refillPerSecond > 0)
    }

    fun tryAcquire(critical: Boolean = false): Boolean {
        refill()
        val pendingLimit =
            if (critical) maximumPending else maximumPending - reservedCriticalSlots
        if (pending >= pendingLimit) return false
        if (!critical && availableTokens < 1.0) return false
        if (!critical) availableTokens -= 1.0
        pending += 1
        return true
    }

    fun release() {
        check(pending > 0) { "Bridge forward gate released without an acquisition" }
        pending -= 1
    }

    internal val pendingCount: Int
        get() = pending

    private fun refill() {
        val now = clockMilliseconds()
        val elapsed = (now - lastRefillMilliseconds).coerceAtLeast(0)
        if (elapsed == 0L) return
        availableTokens = min(
            maximumTokens,
            availableTokens + (elapsed.toDouble() * refillPerSecond / 1000.0),
        )
        lastRefillMilliseconds = now
    }
}
