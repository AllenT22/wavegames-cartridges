# Reference cartridges

`connect-four/` is the Cartridge API 1 reference game. It demonstrates:

- deterministic, UI-independent authority rules;
- immutable per-seat views instead of exposing authority state;
- a self-contained mobile/simulator bridge client;
- a responsive playable interface; and
- a scenario that proves turn enforcement and a complete horizontal win.

`checkers/`, `chess/`, and `go/` are parity migrations of the
first-party games. Checkers proves forced multi-action turns and promotion.
Chess proves a larger deterministic rules surface. Go proves that a full
19-by-19 public board, captures, ko, and deterministic area scoring fit the
API 1 state/view limits.

`color-match/` uses deterministic matching-card rules with private hands for
two to eight players and original geometric artwork. See its `RULES.md` for
the turn, declaration, scoring, and package compatibility details.

Validate and play it with:

```text
node tools/wavegame/bin/wavegame.mjs test cartridges/connect-four
node tools/wavegame/bin/wavegame.mjs dev cartridges/connect-four
```

Every first-party directory is ordinary cartridge source. Use `wavegame pack`
to create the `.wavegame` file that can be selected from Downloads or Files.
The reproducible public packages and checksums are checked into
`releases/1.1.0/` for direct download.

Build the complete public-unverified release—with all five import files, checksums,
testing instructions, source, and developer tools—with:

```text
node tools/wavegame/bin/build-first-party.mjs
```
