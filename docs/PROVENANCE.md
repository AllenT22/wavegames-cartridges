# Source and release history

The public collection began as an export of WaveGames cartridge-engine work
at source commit 86694326bfdeb3779c15d424605f8e2b806b1286. This is historical
provenance, not a statement that the full phone app or radio firmware is
included here.

The public repository history records the subsequent work:

| Public commit | Change |
| --- | --- |
| e224edf | Initial cartridge collection |
| ddb359e | Removed an earlier branded card game from current distribution |
| cc266ab | Introduced Color Match with its own identity and geometric artwork |
| 7444e83 | Audited the five games and published the 1.1.0 collection |

Current examples cover forced-capture Checkers, Chess with castling/en passant/
promotion/draw handling, Connect Four, 19x19 Go with simple ko and Chinese-area
scoring, and Color Match with private hands and scored rounds. The public
Chess cartridge does not implement a running chess clock. See each rules module
and its scenarios for actual behavior rather than assuming tournament-rule parity.

[releases/1.1.0](../releases/1.1.0/) is the current cartridge collection;
[releases/1.0.0](../releases/1.0.0/) is retained for existing links/installations.
The source ZIPs preserve the exact game/toolkit snapshots used for those
artifacts. New root/docs guidance does not change their frozen contents.

The separately uploaded Android APK is the 0.4.2/build 37 test candidate.
It adds public numbered channels, in-app channel creation, and MeshCore-only
game encryption. All participating phones must update together. The earlier
0.4.0/build 35 APK remains at its original release URL.
Its version is not the cartridge collection version. The runtime plugin in
this repository is a public source snapshot; it is not a copy of the complete
current phone app. Package IDs and APIs describe compatibility, not independent
proof of platform or physical-radio acceptance.

The repository does not currently include a project-wide license. The native
runtime's Apache-2.0 notice applies to that component; do not infer a blanket
license for the rest of the collection from public visibility.
