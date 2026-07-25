# @hukt-labs/resolver

One-line integration for Solana Token-2022 transfer-hook tokens.
`resolver.resolve(mint)` returns the hook program and the extra accounts a
transfer needs, resolved against live chain state, plus the hook's HUKT
registry attestation. `resolver.buildTransfer(...)` returns a
`transferChecked` instruction with the extra accounts already injected, so
wallets, DEXs, and lending protocols can move hooked tokens without
hand-building account lists.

Works with any public RPC endpoint; no API key required. Node 18 or newer
(TypeScript types included).

## Install

```bash
npm install @hukt-labs/resolver @solana/web3.js
```

## Usage

```ts
import { Connection } from "@solana/web3.js";
import { HuktResolver } from "@hukt-labs/resolver";

const resolver = new HuktResolver(new Connection(RPC_URL));

// One call: hook program, resolved extra accounts, and whether the
// hook is attested in the registry.
const hook = await resolver.resolve(mint);

// Or build the whole transfer with the extra accounts injected.
const ix = await resolver.buildTransfer({
  source, mint, destination, owner, amount, decimals,
});
```

Real output against the devnet demo mint
`6rEQuznf2awpSEnrC8DsPbqq6cAHN3Vkk6xRRoYL9V29`:

```json
{
  "mint": "6rEQuznf2awpSEnrC8DsPbqq6cAHN3Vkk6xRRoYL9V29",
  "programId": "4q7Tgd9A1XfTB2i6WLUjmFXNocw6GrshZwcKgarGV9aC",
  "extraAccounts": [
    { "pubkey": "5ztfBpMR4tqFZHqdtxkm34K9kPrqd2VGfMwzzsVKpWKJ", "isSigner": false, "isWritable": false, "derivedFromSeeds": true },
    { "pubkey": "31B4LSMMpaGSEgUtPtdya25UvC7uyKUo3ymJF2KbzRND", "isSigner": false, "isWritable": false, "derivedFromSeeds": true },
    { "pubkey": "FU4WVjHHiZ35gnSmWyy6jdpysAJLBVYYWREdRsiXyqhG", "isSigner": false, "isWritable": false, "derivedFromSeeds": true }
  ],
  "attested": true,
  "attestation": {
    "authority": "472iAFz5YD3mNpmp4TKSVuksm9rYjXHYmqLkfs3rpjzt",
    "timestamp": 1783826953,
    "level": "safe"
  }
}
```

## How it works

- `resolve(mint)` reads the mint's TransferHook extension, derives the
  `ExtraAccountMetaList` PDA (seeds `["extra-account-metas", mint]` under the
  hook program), and resolves every entry against the on-chain Execute account
  order (0 source, 1 mint, 2 destination, 3 authority, 4 validation PDA,
  5+ extras) -- the same resolution the hook program performs. Context for
  data-dependent seeds prefers token accounts observed in a real hooked
  transfer of the mint.
- Attestation comes from the HUKT indexer (`https://api.hukt.fun` by default;
  override with `new HuktResolver(connection, { apiUrl })`). When the indexer
  is unreachable, `attested` and `attestation` are left undefined -- the
  package never fabricates a verdict.
- `buildTransfer(...)` delegates to spl-token's
  `createTransferCheckedWithTransferHookInstruction`, so the returned
  instruction carries the resolved extras plus the hook program and validation
  PDA in the exact order Token-2022 expects.

## Related

- `hukt-cli` -- the same resolution from the command line
  (`npm install -g hukt-cli`).
- `@hukt/account-resolver` -- lower-level resolution primitives, in the
  [HuktYard/hukt](https://github.com/HuktYard/hukt) repo.

MIT (c) hukt-labs
