# Contributing

`@hukt-labs/resolver` is the one-line integration surface for HUKT's Token-2022
transfer-hook framework. The programs, shared Rust libraries, and lower-level
resolution primitives live in the
[HuktYard/hukt](https://github.com/HuktYard/hukt) monorepo.

## Development

    npm install
    npm run typecheck
    npm test

Tests run under vitest. The package targets Node 18+ and ships TypeScript types.

## Ground rules

- Resolution is verification-only: the resolver reconstructs the accounts a
  transfer needs, it never signs or sends. Keep the Execute account order
  (0 source, 1 mint, 2 destination, 3 authority, 4 validation PDA, 5+ extras).
- Never fabricate an attestation. When the indexer is unreachable, leave
  `attested` and `attestation` undefined.
- `buildTransfer` must delegate to spl-token's transfer-hook helper so the
  instruction carries the extras in the order Token-2022 expects.

## Reporting issues

Open an issue with the mint, the RPC, and the resolved output. For anything
security-sensitive, follow [SECURITY.md](./SECURITY.md).
