# Radio and protocol notes

These notes describe the MeshCore game transport in Android **0.4.2/build 37**.
The complete phone app and radio driver are maintained separately. Cartridge
code uses the SDK and does not issue radio commands or manage encryption.
The public runtime/plugin snapshot is not the complete phone application.

## Channels and setup

Each phone connects over Bluetooth to its own stock MeshCore Companion radio.
Players select **WaveGames 1, 2, or 3** inside WaveGames. Each number has the
same publicly known shared key on every app. Local radio slot indices may
be different. WaveGames reads available slots, reuses a matching channel, or
creates the selected one using stock Companion `SET_CHANNEL` in a confirmed
empty slot. It reads the result back and preserves occupied slots, including
similarly named channels with a different key. Full radios require a free slot.

Configure matching RF settings and routing scope in MeshCore first, then
release that app's Bluetooth connection. WaveGames leaves identity, RF
parameters, scope, power, bonds, and existing occupied channels intact. No
custom radio firmware is required. This integration targets Companion v1.17.1.

Several lobbies can coexist on the same channel because each has a session ID.
Different numbers partition discovery and game traffic, not RF capacity: radios
on the same RF preset still share airtime. Channels avoid requiring individual
MeshCore contact exchange for lobby discovery. Targeted game packets can still
use a saved direct route; using a channel does not force all traffic to flood.
Compatible repeaters can forward packets without holding the channel key, when
RF parameters, scope, and forwarding policy allow. Companion endpoints do not
normally repeat transit traffic.

## Phone-to-phone delivery

1. The host phone broadcasts a lobby through its radio on the selected channel.
2. The guest radio decrypts the channel packet and delivers it over Bluetooth.
   The guest app lists a lobby only when its package ID, API, and exact digest
   match the installed game.
3. The guest requests to join; the host approves and assigns a seat. The compact
   join exchanges no app public keys. Game files never travel over the radio.
4. A guest action is encoded by the app and passed over Bluetooth to its radio.
   MeshCore encrypts the channel datagram, sends it directly or through
   repeaters, and the host radio decrypts it before forwarding it to the phone.
5. The host phone validates the action, session, and seat, rejects duplicates,
   applies the rules, and returns the relevant view and acknowledgement through
   the same radio path. Radios never execute cartridge rules.
6. Bounded retries preserve logical request identity so ordinary repeated
   actions do not execute twice. Reconnection restores the host's current view.
   A local command OK does not prove remote receipt or successful gameplay.

## Encryption and trust

MeshCore channel encryption is the only encryption for game logic on this
adapter. WaveGames adds no P-256 key exchange, AES-GCM cipher, or application
16-byte authentication tag. The numbered channels are intentionally public.
Other channel members can read game traffic, including hidden hands or boards,
and construct forged packets. Host approval and station/session checks organize
gameplay; they are not cryptographic player identity.

The host still validates rules, derives actors from approved sessions rather
than action-supplied player IDs, applies sequence/replay checks, deduplicates
requests, and generates seat-filtered views. Filtering prevents ordinary UIs
from receiving the full authority state; it does not make the on-air views
secret from other channel members. The retained ESP-NOW adapter and separate
private messaging protocols have their own protection and are not changed by
this game-traffic profile.

## Framing and efficiency

The MeshCore application datagram limit is **163 bytes**. The WaveGames v2
envelope uses 30 bytes, leaving 133 bytes for a WaveWire fragment. Channel game
sessions set `channelProtected` (`0x08`) and carry zero app-tag bytes. Imported
games use WaveWire game ID 0 and WCP records capped at 101 bytes on this path;
fragmented records use 85 data bytes plus a 16-byte WCP fragment header.

At normal BLE capacity with a short route,
`30-byte envelope + 28-byte WaveWire header + 101-byte WCP + 4-byte CRC = 163`.
This keeps a normal application fragment in one radio datagram. Small BLE
capacities or long explicit routes can still cause transport fragmentation.
Large actions/views require multiple application fragments. API 1 limits stay
512 bytes per action and 2 KiB per player view. Keep updates small and infrequent;
do not stream animations, audio, or continuous UI state.

Application acknowledgements own imported-game reliability, avoiding redundant
transport ACKs. The host owns fragmentation, sequence checks, request identity,
state recovery, and retries; cartridges should act on confirmed host views.

The current MeshCore LoRa profile uses:

| Operation | Interval/deadline |
| --- | ---: |
| Lobby advertisement / expiry | 30 / 90 seconds |
| Heartbeat | 45 seconds |
| Join/approval window | 2 minutes |
| Absolute join timeout | 5 minutes |
| Join confirmation timeout | 90 seconds |
| Peer marked recovering | 2 minutes of silence |
| Peer timeout | 10 minutes of silence |
| Reliable fragment acknowledgement | 30 seconds |
| Fragment reassembly idle timeout | 120 seconds |

These are implementation defaults, not latency guarantees or SDK constants.
The SDK's 30-second Promise deadline is separate: a timed-out action may have
arrived. Check the current view before offering a retry rather than resending
blindly. MeshCore's small RAM queue is shared with other apps and message types;
consumed messages may no longer be waiting for MeshCore. It does not guarantee
offline delivery or transparent mailbox handoff.

## Migration and acceptance

Every participating phone must update together. Envelope v2 deliberately
rejects older clients instead of mixing encryption and fragment-size contracts.
Existing cartridge packages and the Cartridge API remain unchanged. Old APKs
and frozen cartridge releases retain their original setup instructions.

Automated tests and package checks do not prove physical LoRa, repeater,
background/reconnect, or crowded-channel play. Test both host directions,
different local channel slots, separate numbered channels, full radio storage,
join/action/retry/recovery, and representative player counts with actual phones
and radios. See [player setup](PLAYING.md) and [validation](VALIDATION.md).
