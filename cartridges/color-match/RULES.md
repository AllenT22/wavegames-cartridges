# Color Match

Match the current color or number to play a card. Action cards skip a turn,
reverse direction, or add a draw penalty. Color-choice cards let the player
choose the next color; the draw-four action can be challenged.

Declare one card before playing down to a single card. Another player can
catch a missed declaration before play continues, causing a two-card penalty.
Rounds are scored from the cards left in opponents’ hands. The first player
to 500 points wins the match; all players must agree to a rematch.

The deterministic rules support two to eight fixed seats. Each player sees
only their own hand, with public card counts and scores for the other seats.
The host validates actions and supplies legal-card and action flags to the UI.
A player timeout or host loss ends the match rather than redistributing a hand.

This cartridge uses the existing API 1 matching-card rules. The package ID,
action/view names, labels, and geometric artwork have changed. All players
must import the same Color Match package; this is a separate cartridge identity
and does not resume saved matches from the previous package.
