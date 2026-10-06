# Source provenance

This repository was assembled from the WaveGames 0.3 cartridge-engine work at
commit `86694326bfdeb3779c15d424605f8e2b806b1286`.

The cartridge migrations preserve the behavior developed on these WaveGames
feature lines:

- Checkers: mandatory captures, multi-jumps, promotion, and rematches.
- Chess: full legal move generation, castling, en passant, promotion, clocks,
  standard draw conditions, and rematches.
- Connect Four: deterministic two-player column-drop rules.
- Go: 19x19 captures, suicide prevention, simple ko, two-pass ending,
  Chinese-area scoring, and 6.5 komi.

Color Match uses the existing public matching-card reducer with descriptive
labels, a new package identity, and original geometric card artwork.

Cartridge API 1 uses wire game ID `0`; it therefore avoids provisional compiled
game-ID collisions. The cartridges are phone-authoritative, and boards forward
their authenticated traffic without executing cartridge rules or distributing
package files.
