# Changelog

All notable changes to `@hukt-labs/resolver` are recorded here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package
uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0]

First published release.

### Added

- `HuktResolver#resolve(mint)` returns the hook program id, the resolved extra
  accounts a transfer needs (against live chain state), and the hook's HUKT
  registry attestation when the indexer is reachable.
- `HuktResolver#buildTransfer(...)` returns a `transferChecked` instruction with
  the resolved extra accounts, hook program, and validation PDA injected in the
  order Token-2022 expects.
- TypeScript types for the resolved account set and the attestation, shipped in
  `dist`.

[0.1.0]: https://github.com/HuktYard/hukt-resolver/releases/tag/v0.1.0
