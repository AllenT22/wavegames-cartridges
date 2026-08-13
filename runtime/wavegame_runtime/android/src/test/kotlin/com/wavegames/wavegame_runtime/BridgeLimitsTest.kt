package com.wavegames.wavegame_runtime

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class BridgeLimitsTest {
    @Test
    fun rejectsCharacterAndUtf8OverflowBeforeQueueing() {
        val gate = BridgeIngressGate(maximumBytes = 8, maximumPending = 2)

        assertEquals(
            BridgeIngressRejection.TOO_LARGE,
            gate.tryAcquire("123456789"),
        )
        assertEquals(
            BridgeIngressRejection.TOO_LARGE,
            gate.tryAcquire("1234567é"),
        )
        assertEquals(0, gate.pendingCount)
    }

    @Test
    fun retainsOnlyTheConfiguredNumberOfQueuedMessages() {
        val gate = BridgeIngressGate(maximumBytes = 32, maximumPending = 2)

        assertNull(gate.tryAcquire("{}"))
        assertNull(gate.tryAcquire("{}"))
        assertEquals(BridgeIngressRejection.OVERLOADED, gate.tryAcquire("{}"))
        assertEquals(2, gate.pendingCount)
        gate.release()
        assertNull(gate.tryAcquire("{}"))
    }

    @Test
    fun forwardGateCapsPendingAndRateWhileReservingTerminalNotice() {
        var now = 0L
        val gate = BridgeForwardGate(
            maximumPending = 3,
            reservedCriticalSlots = 1,
            burst = 2,
            refillPerSecond = 1.0,
            clockMilliseconds = { now },
        )

        assertTrue(gate.tryAcquire())
        assertTrue(gate.tryAcquire())
        assertFalse(gate.tryAcquire())
        assertTrue(gate.tryAcquire(critical = true))
        assertFalse(gate.tryAcquire(critical = true))
        assertEquals(3, gate.pendingCount)

        gate.release()
        gate.release()
        gate.release()
        assertFalse(gate.tryAcquire())
        now = 1000L
        assertTrue(gate.tryAcquire())
    }
}
