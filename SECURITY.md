# Security Policy

`@hukt-labs/resolver` reads chain and indexer state to reconstruct the accounts
a hooked transfer needs. It holds no keys and sends no transactions, so its main
risk is returning an incorrect or unsafe account set, or misreporting an
attestation.

## Reporting a vulnerability

Please report privately rather than opening a public issue:

- Open a private vulnerability report through GitHub's "Report a vulnerability"
  flow on [HuktYard/hukt](https://github.com/HuktYard/hukt/security/advisories/new), or
- Reach out over [@huktfun](https://x.com/huktfun) and we will open a private
  advisory.

Useful details: the mint, the RPC and indexer used, the resolved account set you
believe is wrong, and the expected set.

## Scope

In scope: the resolver reconstructing an incorrect or unsafe account set, or
reporting an attestation that does not match the registry. Out of scope: the
indexer being unreachable (the package leaves attestation undefined by design).
Soundness of the hook and registry programs is tracked in
[HuktYard/hukt](https://github.com/HuktYard/hukt).
