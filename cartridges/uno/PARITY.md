# UNO cartridge parity notes

The API 1 rules are a direct behavioral port of
`core/src/wg_uno_internal.cpp` and its C++ evidence in
`tests/core/test_uno.cpp`:

- standard 108-card deck, seven-card deal, and 2–8 fixed seats;
- draw/play/pass and the drawn-card-only restriction;
- two-player Skip and Reverse behavior, multi-player direction, Draw Two;
- opening Wild color choice and rejection of an opening Wild Draw Four;
- legal and illegal Wild Draw Four challenges, including a final +4;
- pre-play UNO declaration, the catch window, and two-card catch penalty;
- standard card scoring, dealer rotation, 500-point match finish, and unanimous
  rematch reset.

Authority state and the host RNG never enter the renderer. Each view contains
all public card counts and scores, but only the viewer's 54 card counts. The
renderer consumes authority-provided `legalCards` and `can*` flags; it does not
calculate legal moves.

Two deliberate API-boundary differences remain:

1. The initial shuffle uses API 1's authoritative 32-bit seed and Mulberry32,
   while the embedded C++ implementation uses a mixed 64-bit xorshift state.
   Later round and discard-pile shuffles consume the replayable host RNG. Deck
   composition and every rule outcome match, but identical numeric seeds do not
   promise the same cross-engine deal order.
2. The C++ UNO reducer has no surrender or timeout mutation. This cartridge
   likewise rejects voluntary surrender. Its optional `playerTimedOut` hook
   returns a fail-closed `ended: true` policy because removing a fixed player
   would require exposing or redistributing a hidden hand. API 1 host loss also
   ends the match. The timeout result shape follows the cartridge engine design
   contract; current local play never invokes it.
