# WaveWire and test-mesh protocol

WaveWire is a canonical, little-endian binary protocol. Packed C structs are
not sent over the wire. A complete WaveWire frame is at most 160 bytes.

## Frame

```text
magic[2]          "WG"
protocol_version  u8
message_type      u8
flags             u8
game_id           u8
session_id        u64
request_id        u32
revision          u32
packet_sequence   u32
payload_length    u8
auth_tag_length   u8 (0 or 16)
payload           payload_length bytes
auth_tag          auth_tag_length bytes when authenticated protection is set
crc32c            u32 over every preceding byte
```

The fixed header is 28 bytes. An authenticated frame therefore has at most 112
payload bytes (`28 + 112 + 16 + 4 = 160`); an unauthenticated frame can use up
to 128 payload bytes. Version 1 message families are lobby advertisement, join
request, join accept, join reject, intent, outcome, view snapshot, resync
request, acknowledgement, heartbeat, leave, and error. Decoders reject unknown
versions, unknown flags, length disagreement, oversized frames, and a bad CRC
before dispatch.

Lobby advertisements are public and contain only station ID, game, host
location, capacity, and a short display name. WaveWire match frames exchanged
between endpoints become protected after join. The authenticated flag is set
only after the secure-session backend has produced and verified the 16-byte
tag; a CRC alone never marks a frame as secure. The ESP-NOW relay can therefore
forward opaque protected bytes without knowing game state. This protection is
separate from the local version 0.2.0 phone-to-board BLE link, which requires an
authenticated and encrypted Secure Connections bond plus roster authorization.

Wire game ID `0` identifies a phone-authority cartridge session. The cartridge
control protocol advertises the reverse-domain package ID, engine API, exact
32-byte content digest, player limits, and locked roster. A guest may join only
when its locally installed package is an exact match; packages are never sent
through WaveWire. Cartridge actions, filtered views, rosters, and status records
are bounded logical messages that fragment within authenticated payloads when
necessary. Every authenticated cartridge frame, including heartbeat, leave,
and error, uses the outer mesh `Session` packet type. Built-in game IDs and
their existing payload encodings are unchanged.

The accepted session path determines the actor. An actor value inside a payload
never grants an identity. The endpoint assigns its local actor only to its
authenticated, roster-authorized GATT connection. Every mesh node binds a
claimed source or learned next hop to the actual ESP-NOW sender MAC.

`OUTCOME` is a trusted-replication format, not automatically a player broadcast.
In Battleships, placement and randomization outcomes contain deterministic
replay inputs and are authority-local. Opponents receive `VIEW_SNAPSHOT` frames
encoded for their session actor, which contain no unhit ship locations or
placement seed.

## Endpoint-to-endpoint match protection

Join messages exchange 65-byte uncompressed SEC1 P-256 public keys. ECDH feeds
HKDF-SHA256 with the little-endian session ID as salt and the two public keys in
lexicographic order as info. The 64-byte result is split into directional
AES-256-GCM keys. A nonce is the little-endian session ID followed by the
little-endian packet sequence; WaveWire header bytes 0 through 27 are additional
authenticated data, and the tag is 16 bytes. Receivers use a 64-sequence sliding
replay window that permits unseen reordered frames and rejects repeats. This
protects against passive observation but does not authenticate the handshake
against an active attacker. It protects match frames traveling between endpoint
boards; it does not provide BLE link encryption between a phone and its local
endpoint.

## ESP-NOW mesh envelope

```text
magic[2]          "WM"
network_version   u8 (2)
packet_type       u8
flags             u8 (reliable, relayed)
source_station    u64
dest_station      u64
packet_id         u32
hop_limit         u8
hop_count         u8
payload_length    u8
WaveWire frame    payload_length bytes
crc32c            u32
```

The 28-byte header plus a 160-byte WaveWire frame and four-byte CRC produces a
maximum 192-byte envelope, below the ESP-NOW v1 payload ceiling. Version 2 adds
the `Discovery` packet type and removes the configured-relay interpretation of
the route. Discovery payloads contain no game data. A direct beacon establishes
a one-hop neighbor; receiving a valid packet may refresh a learned route to its
source through the actual radio sender.

Nodes prefer a fresh direct neighbor, then a fresh learned next hop, then a
hop-limited broadcast fallback. Neighbors and routes expire, and a failed
reliable route is invalidated before retry. Forwarding increments `hop_count`
and sets the relayed flag without modifying WaveWire. Source-scoped packet IDs,
bounded duplicate delivery and forwarding histories, and the hop limit prevent
loops, repeated actions, and uncontrolled rebroadcasting. A fresh direct beacon
replaces an older indirect route.

Application acknowledgement is distinct from the ESP-NOW send callback. Outer
`Ack` is reserved for this link acknowledgement and carries the acknowledged
packet ID as four little-endian bytes. A transport retry retains the packet ID,
and an intent retry retains its logical request ID, so a dropped acknowledgement
cannot execute a turn twice.
Mesh protocol version 1 firmware is incompatible with version 2, so update all
participating boards together. The enclosed WaveWire version is unchanged.

## BLE logical-frame fragmentation

The endpoint exposes service `7A1E0000-8D52-4C65-A7F0-574156454741` with an
information characteristic ending in `0001` (read), phone-to-board data ending
in `0002` (write with response), and board-to-phone data ending in `0003`
(indicate). Information reports station ID, firmware and protocol versions,
role, and capabilities. In version 0.2.0, information reads and phone-to-board
writes require encryption and authenticated access. Reading information makes
Android or iOS own the Secure Connections passkey prompt. The endpoint accepts
one active BLE connection and only authorizes one of its three persisted phone
identities outside a physical BOOT enrollment window.

Each ATT write or indication begins with:

```text
message_id        u16
fragment_index    u8
fragment_count    u8
```

There is one in-flight message in each direction. Fragments must be ordered,
duplicates are ignored, and an incomplete message expires after five seconds.
This is link adaptation only; WaveWire and the game engine do not contain BLE
fragmentation logic.
