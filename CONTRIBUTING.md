# Contributing

Read the [developer guide](docs/DEVELOPING.md), [API contract](docs/CARTRIDGE_ENGINE.md),
and [validation instructions](docs/VALIDATION.md) before changing a cartridge or tool.

## Changes

Work on a branch from main and explain the player/developer problem and resulting
behavior in a pull request. Keep game rules, UI, tooling, and documentation
changes scoped so reviewers can verify them. Use plain English commit messages.

For a rules change, include legal and illegal actions, turn enforcement,
end conditions, deterministic replay, and per-seat privacy checks. For UI work,
verify pending/disconnected states, first-view rendering, small screens,
keyboard focus, and packaged resources. Never trust UI validation for authority.

Run the repository's existing checks. Document what actually ran and what
still needs real phones/radios. Do not describe simulated or automated results
as physical acceptance. New runtime/host contracts need both simulator and native
integration evidence; the public plugin alone is not the full application.

## Packages and public artifacts

- Use your own reverse-domain game ID and original/licensed names and assets.
- Bump versions when distributing changed game content. Match players by exact
  digest, not only version/title.
- Do not overwrite published release files or regenerate historical archives.
  Toolkit files and cartridges/README.md are release-builder inputs too.
- Coordinate new collection versions, build script, release directory, CI diff
  target, download links, and checksums together.
- Keep app APK versions/builds separate from game versions and API versions.
- Do not commit caches, private application code, local device dumps, tokens,
  channel keys, signing files, or private player information.

## Bug reports

Use [GitHub Issues](https://github.com/AllenT22/wavegames-cartridges/issues).
Include the game ID/version/digest, app version/build, phone OS, and exact
reproduction steps with expected/observed behavior. State whether the problem
occurs in the browser simulator, native runtime, or a physical radio match.
For radio issues include nonsecret firmware version/topology details; omit
channel keys, PINs, identities, and private message contents. A minimal replay
or test scenario is useful after removing private game/player information.

For a possible security issue, do not post credentials, private channel keys,
or exploit details exposing another user in a public issue. Use the maintainer's
[contact page](https://tiethoffserver.com/contact.html) to arrange a private report.
There is no guaranteed response-time policy documented here.

## Licensing

There is no repository-wide license file at present. The native runtime
contains its own [Apache-2.0 notice](runtime/wavegame_runtime/LICENSE).
Confirm the terms for other components with the maintainer before reuse or
redistribution; do not assume that notice covers games, toolkit, or all assets.
See [GitHub's licensing explanation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)
for the distinction between a public repository and a licensed project.
No new project-wide license is assigned by these documentation changes.
