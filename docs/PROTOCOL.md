# Radio and protocol notes

Cartridge authors use the game SDK, not radio commands. The complete phone
transport is maintained outside this repository. These notes describe the
MeshCore integration used by the published Android 0.4.0/build 35 candidate and
explain what a cartridge may rely on. They are not a standalone radio-driver
implementation or a claim that every firmware/repeater combination is tested.

## Channel and forwarding

Each phone connects by Bluetooth to its own MeshCore Companion radio. The app
uses MeshCore channel data over LoRa, with the same private channel named
WaveGames and the same random channel key on participating radios. Local
channel slots may differ. The integration targets Companion v1.17.1; compatible
repeaters must support group-data forwarding and compatible radio settings,
routing scope, and policy. Repeaters can forward ciphertext without the key;
phone-facing Companion endpoints are not general relays.

Configure the radio in the MeshCore app before connecting WaveGames. The app
uses the saved identity, channel, radio settings, and scope. Do not assume a
live Bluetooth connection can be transferred between apps; disconnect the
current app first. See [player setup](PLAYING.md).

## Encryption and its limits

MeshCore's shared channel key protects channel traffic. Separately, the
WaveGames host negotiates a pairwise P-256 ECDH session with each approved
player, derives directional keys using HKDF-SHA256, and protects match frames
with AES-256-GCM and replay checks. Channel privacy and game-session protection
are different layers; a shared channel key is not a per-player identity.

Message authentication validates traffic under the negotiated session key.
The key exchange does not independently verify a real-world player identity
or authenticate the handshake against an active man-in-the-middle. Do not
advertise approval or encryption as such a guarantee. Keep channel keys and
session material out of cartridge code, diagnostics, screenshots, and reports.

## Host-owned delivery

Imported cartridges use WaveWire game ID 0. Lobby negotiation identifies the
package ID, engine API, exact content digest, and roster. The host, rather than
the game, owns authenticated actors, request deduplication, fragmentation,
acknowledgements, recovery snapshots, and delivery retries. A successful local
Bluetooth/radio command does not establish remote receipt.

The Companion channel-data limit used by this integration is 163 bytes. Its
30-byte WaveGames envelope leaves up to 133 bytes per fragment. An API 1 action
or player view can span multiple fragments; the cartridge author must still
meet the 512-byte action and 2-KiB view limits. Reduce view size and action
frequency rather than streaming animation, audio, or continuous UI state.

The current host's MeshCore LoRa timing profile is:

| Operation | Interval/deadline |
| --- | ---: |
| Lobby advertisement | 30 seconds |
| Lobby expiry | 90 seconds |
| Heartbeat | 45 seconds |
| Join/approval window | 2 minutes |
| Absolute join timeout | 5 minutes |
| Secure confirmation timeout | 90 seconds |
| Peer marked unavailable/recovering | 2 minutes of silence |
| Peer timeout | 10 minutes of silence |
| Reliable fragment acknowledgement | 30 seconds |

These are host defaults for that implementation, not latency guarantees or
cartridge API constants. They differ from the fast prototype profile. A game
must react to host status and confirmed views, not run its own radio timer.
The SDK's 30-second Promise deadline is also a separate boundary: if a request
times out, a move may still have arrived. Do not automatically resend it.

MeshCore's small RAM queue is shared with other message types and apps. A
message consumed while WaveGames owns the radio may no longer be available to
the MeshCore app. Queue contents do not provide guaranteed offline delivery or
transparent mailbox handoff. Restore game state from the host when reconnecting.

## Scope

Earlier ESP-NOW gateway firmware and its envelope/BLE details describe a
prototype transport. They are not MeshCore setup instructions or part of the
public cartridge-authoring interface. Retaining a historical wire ID does not
make a legacy game a supported built-in. Neither the radio driver, firmware,
nor the complete WaveGames application is supplied by this repository.
