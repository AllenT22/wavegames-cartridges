# Setup and troubleshooting

## Install the application

[Download the Android APK](https://github.com/AllenT22/wavegames-cartridges/releases/download/android-v0.4.2-build37/WaveGames-0.4.2-android.apk)
and open it on your phone. This is WaveGames 0.4.2, build 37, requiring Android
12 or newer. Android may ask you to allow installation from the browser or file
manager you used. The [release page](https://github.com/AllenT22/wavegames-cartridges/releases/tag/android-v0.4.2-build37)
provides the checksum. iPhone access is currently limited; this repository does
not provide a public iPhone installer.

The APK is a test build. Update every participating phone to 0.4.2/build 37
or a compatible newer version; the new MeshCore envelope does not mix with
older apps. Install over the existing app to retain its data and pairing. Successful installation does not establish
radio range, repeater compatibility, or completed multiplayer acceptance.

## Connect to your radio

Each player uses their own MeshCore Companion radio.

1. Attach the appropriate antenna. In the MeshCore app, configure matching
   radio parameters and routing scope using settings permitted in your region.
2. Disconnect the MeshCore app so it releases the Bluetooth connection.
3. In WaveGames, choose **Game channel → WaveGames 1, 2, or 3**. Everyone
   selecting the same number joins the same public group.
4. Connect to your radio and allow Bluetooth permissions. WaveGames reuses
   the matching channel or creates it in a confirmed empty slot, then checks
   that it saved correctly. Local slot numbers may differ between radios.
   If the radio is full, free a slot in the MeshCore app and reconnect.

Change channel numbers from the lobby after closing any open game or lobby.
The app remembers your choice and reconnects the radio. Existing occupied
channels and radio settings are preserved. Multiple games can share a channel;
numbered channels still share RF airtime and do not increase radio capacity.
MeshCore provides the game's radio encryption. These channels are public, so
other channel members can inspect or forge traffic. Hidden game information
is not cryptographically private from them.

The app's current integration targets the **MeshCore Companion v1.17.1 protocol**.
Do not assume that any radio running any MeshCore version is compatible.
WaveGames preserves the radio's saved identity, RF parameters, scope, and
existing occupied channels. It creates only the selected game channel in an
empty slot. No WaveGames-specific radio firmware is needed.

When switching back to the MeshCore app, disconnect WaveGames first. If the
other app still owns the radio, disconnect or close it before trying again.
Bluetooth pairing by itself does not establish a working WaveGames connection.

Compatible MeshCore repeaters can forward game traffic when radio settings,
routing scope, and forwarding policy allow it. Another player's Companion
radio is not automatically a repeater. No fixed range or guaranteed community
repeater coverage is claimed. More detail is in [protocol notes](PROTOCOL.md).

## Add a game

1. Download a `.wavegame` file from [the game catalog](https://wavegames.tiethoffserver.com/catalog.html)
   or [the 1.1.0 release directory](../releases/1.1.0/).
2. Save it to Downloads or Files. If you downloaded a ZIP bundle, extract it first.
3. In WaveGames, open **Game Library → Import game** and choose the file.
4. Import the exact same file on every player's phone.

The app checks package ID, engine API, and the complete content digest. Two
files with the same title or version can still be different builds. Download
one release file and share that same file with everyone if a mismatch occurs.
The radios do not distribute game files.

**Unverified** means the package has no verified publisher signature. The app
still checks its structure and hashes. Only import files from a source you trust.
Older release ZIP notes may use the earlier labels Library / Import cartridge;
current instructions use Game Library / Import game.

## Host a game

Return to the game lobby. The host chooses the installed game and approves
joining players. For games with variable player counts, the host selects the
room size. Play begins after the selected seats complete confirmation.

The player roster is fixed once play starts. API 1 has no spectators, late
joins, host migration, or saved online-match resume. A departure or expired
connection timeout ends the match. Temporary loss can enter recovery first;
timing depends on the transport. Keep the host app and radio connected.

## If something does not work

| Symptom | Check |
| --- | --- |
| Radio not found or connection stuck | Power, proximity, Bluetooth permission, and whether another app owns the connection |
| Channel setup fails | A free radio channel slot, supported Companion firmware, and Bluetooth released by the other app |
| Other player's lobby missing | Compatible updated apps, same Game channel number and game file, open lobby, matching RF settings/scope, and a usable radio route |
| Game build mismatch | Re-download and import the same release file on every phone |
| Unverified label | Expected for these unsigned packages; it is not a failed checksum |
| Move response times out | Check the current view before trying again; the move may already have arrived |
| Simulator works but phones do not | Simulator checks do not exercise native WebViews, Bluetooth, LoRa, or repeaters |

MeshCore's pending-message queue is shared, limited, and stored in RAM. While
WaveGames owns the radio, ordinary MeshCore messages may be consumed by that
connection and may no longer be waiting for the MeshCore app. Do not rely on
transparent mailbox handoff or offline delivery during a game.

For a useful bug report, include the app version, game ID/version/digest, phone
OS, radio firmware, and reproduction steps. Never include channel keys,
Bluetooth PINs, signing material, or private player data.
