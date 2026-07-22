// @hukt-labs/resolver -- one-line integration for Token-2022 transfer-hook tokens.
// resolver.resolve(mint) returns the hook program and the extra accounts a
// transfer needs, resolved against live chain state, plus the hook's registry
// attestation when the HUKT indexer is reachable. resolver.buildTransfer()
// returns a transferChecked instruction with the extra accounts injected.
//
// Public RPC only: this package never assumes a keyed endpoint. The caller
// passes any web3.js Connection (e.g. https://api.devnet.solana.com).

import {
  PublicKey,
  type AccountMeta,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createExecuteInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getExtraAccountMetaAddress,
  getExtraAccountMetas,
  getMint,
  getTransferHook,
  resolveExtraAccountMeta,
} from "@solana/spl-token";

export const SDK_VERSION = "0.1.0";

/** Default HUKT indexer/registry API. */
export const DEFAULT_API_URL = "https://api.hukt.fun";

export interface ResolvedAccount {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
  /** True when the account is derived from seeds rather than a fixed key. */
  derivedFromSeeds?: boolean;
}

/** A live registry attestation for a hook program. */
export interface HookAttestation {
  authority: string;
  /** Unix timestamp (seconds). */
  timestamp: number;
  level: string;
}

export interface ResolveResult {
  mint: string;
  programId: string;
  extraAccounts: ResolvedAccount[];
  /**
   * Registry attestation, straight from the HUKT indexer. Both fields are
   * omitted (undefined) when the indexer is unreachable -- never fabricated.
   * attestation is null when the indexer answered but no attestation exists.
   */
  attested?: boolean;
  attestation?: HookAttestation | null;
}

export interface ResolverConfig {
  /** Public RPC endpoint (no API key -- keyed RPC stays server-side). */
  rpcUrl: string;
  /** HUKT indexer base URL for cached hook metadata. */
  apiUrl?: string;
}

/** The contract implemented by the network-backed resolver. */
export interface Resolver {
  resolve(mint: string): Promise<ResolveResult>;
}

/** Indexer endpoint that returns cached transfer-hook metadata for a mint. */
export function hookEndpoint(config: ResolverConfig, mint: string): string {
  const base = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
  return `${base}/hooks/${mint}`;
}

// --- pure helpers (no network; unit-tested) ----------------------------------

/** ISO-8601 timestamp to unix seconds; null when unparseable. */
export function isoToUnixSeconds(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

interface IndexerHookEntry {
  programId?: string;
  attested?: boolean;
  attestation?: { authority?: string; timestamp?: string; level?: string } | null;
  executions?: { source?: string; destination?: string }[];
}

/**
 * Token accounts observed in a real hooked transfer of the mint, from a
 * GET /hooks/{mint} payload; null when the payload records none.
 */
export function extractObservedEndpoints(
  payload: unknown,
): { source: string; destination: string } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const hooks = (payload as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return null;
  for (const hook of hooks as IndexerHookEntry[]) {
    for (const execution of hook?.executions ?? []) {
      if (execution?.source && execution?.destination) {
        return { source: execution.source, destination: execution.destination };
      }
    }
  }
  return null;
}

/**
 * Pick the attestation for a hook program out of a GET /hooks/{mint} payload.
 * Returns undefined when the payload carries no entry for the program.
 */
export function extractAttestation(
  payload: unknown,
  programId: string,
): { attested: boolean; attestation: HookAttestation | null } | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const hooks = (payload as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return undefined;
  const entry = (hooks as IndexerHookEntry[]).find((h) => h && h.programId === programId);
  if (!entry) return undefined;
  const raw = entry.attestation;
  if (!entry.attested || !raw || !raw.authority || !raw.timestamp || !raw.level) {
    return { attested: false, attestation: null };
  }
  const timestamp = isoToUnixSeconds(raw.timestamp);
  if (timestamp === null) return { attested: false, attestation: null };
  return {
    attested: true,
    attestation: { authority: raw.authority, timestamp, level: raw.level },
  };
}

// --- resolver ----------------------------------------------------------------

// Throwaway wallets whose ATAs stand in for the transfer endpoints when the
// mint has no live token accounts to borrow for resolution.
const PLACEHOLDER_SOURCE_OWNER = new PublicKey("J6iWLiiskEMN3Gk8CKRDEo9XtvGxmtL5KyQh9BPjNifu");
const PLACEHOLDER_DEST_OWNER = new PublicKey("EdT3YqxbkMSZ5GF4Ef4vKSVwksqpwbQH1TQr24dt6jsb");

function toPublicKey(value: string | PublicKey, what: string): PublicKey {
  if (value instanceof PublicKey) return value;
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${what} is not a valid base58 public key: ${value}`);
  }
}

export interface BuildTransferArgs {
  source: PublicKey | string;
  mint: PublicKey | string;
  destination: PublicKey | string;
  owner: PublicKey | string;
  amount: bigint | number;
  decimals: number;
}

export class HuktResolver implements Resolver {
  private readonly connection: Connection;
  private readonly apiUrl: string;

  constructor(connection: Connection, opts?: { apiUrl?: string }) {
    this.connection = connection;
    this.apiUrl = (opts?.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
  }

  /**
   * One call: the mint's hook program and the fully resolved extra accounts a
   * transfer needs (same resolution path as @hukt/account-resolver), plus the
   * registry attestation when the indexer answers. Throws when the mint does
   * not exist, is not Token-2022, or carries no transfer hook.
   */
  async resolve(mint: string | PublicKey): Promise<ResolveResult> {
    const mintPk = toPublicKey(mint, "mint");
    const mintInfo = await getMint(this.connection, mintPk, "confirmed", TOKEN_2022_PROGRAM_ID);
    const hook = getTransferHook(mintInfo);
    if (!hook || hook.programId.equals(PublicKey.default)) {
      throw new Error(`mint ${mintPk.toBase58()} has no transfer hook extension`);
    }
    const hookProgramId = hook.programId;

    // One best-effort indexer read serves two purposes: token accounts from a
    // real hooked transfer (context for data-dependent seeds) and the registry
    // attestation. An unreachable indexer leaves attested/attestation
    // undefined rather than inventing an answer.
    let indexerPayload: unknown = null;
    try {
      const res = await fetch(hookEndpoint({ rpcUrl: "", apiUrl: this.apiUrl }, mintPk.toBase58()), {
        signal: AbortSignal.timeout(8000),
        headers: { accept: "application/json" },
      });
      if (res.ok) indexerPayload = await res.json();
    } catch {
      indexerPayload = null;
    }

    const extraAccounts = await this.resolveExtraAccounts(mintPk, hookProgramId, indexerPayload);

    const result: ResolveResult = {
      mint: mintPk.toBase58(),
      programId: hookProgramId.toBase58(),
      extraAccounts,
    };
    if (indexerPayload !== null) {
      const verdict = extractAttestation(indexerPayload, result.programId);
      if (verdict) {
        result.attested = verdict.attested;
        result.attestation = verdict.attestation;
      }
    }
    return result;
  }

  /**
   * A transferChecked instruction with the hook's extra accounts injected,
   * via spl-token's createTransferCheckedWithTransferHookInstruction.
   */
  async buildTransfer(args: BuildTransferArgs): Promise<TransactionInstruction> {
    return createTransferCheckedWithTransferHookInstruction(
      this.connection,
      toPublicKey(args.source, "source"),
      toPublicKey(args.mint, "mint"),
      toPublicKey(args.destination, "destination"),
      toPublicKey(args.owner, "owner"),
      BigInt(args.amount),
      args.decimals,
      [],
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
  }

  /**
   * Resolve the ExtraAccountMetaList against live chain state. previousMetas
   * is seeded with spl-token's Execute account order (0 source, 1 mint,
   * 2 destination, 3 authority, 4 validation PDA) so AccountKey / AccountData /
   * InstructionData seeds index into exactly what the hook program sees.
   */
  private async resolveExtraAccounts(
    mintPk: PublicKey,
    hookProgramId: PublicKey,
    indexerPayload: unknown,
  ): Promise<ResolvedAccount[]> {
    const validationPda = getExtraAccountMetaAddress(mintPk, hookProgramId);
    const validationAccount = await this.connection.getAccountInfo(validationPda, "confirmed");
    if (validationAccount === null) return [];

    const rawMetas = getExtraAccountMetas(validationAccount);
    if (rawMetas.length === 0) return [];

    const context = await this.placeholderContext(mintPk, indexerPayload);
    const executeIx = createExecuteInstruction(
      hookProgramId,
      context.source,
      mintPk,
      context.destination,
      context.authority,
      validationPda,
      1n,
    );
    const previousMetas: AccountMeta[] = executeIx.keys;

    const resolved: ResolvedAccount[] = [];
    for (const meta of rawMetas) {
      const accountMeta = await resolveExtraAccountMeta(
        this.connection,
        meta,
        previousMetas,
        executeIx.data,
        hookProgramId,
      );
      // De-escalate: an extra meta can never raise privileges a pubkey already
      // holds among the accounts resolved so far (mirrors spl-token).
      const prior = previousMetas.filter((x) => x.pubkey.equals(accountMeta.pubkey));
      if (prior.length > 0) {
        if (!prior.some((x) => x.isSigner)) accountMeta.isSigner = false;
        if (!prior.some((x) => x.isWritable)) accountMeta.isWritable = false;
      }
      previousMetas.push(accountMeta);
      resolved.push({
        pubkey: accountMeta.pubkey.toBase58(),
        isSigner: accountMeta.isSigner,
        isWritable: accountMeta.isWritable,
        derivedFromSeeds: meta.discriminator !== 0,
      });
    }
    return resolved;
  }

  /**
   * Endpoints for context-dependent seed resolution: prefer token accounts
   * observed in a real hooked transfer (from the indexer payload), then the
   * mint's largest live holders (getTokenLargestAccounts, which many public
   * RPCs throttle per-method), then placeholder-owner ATAs.
   */
  private async placeholderContext(
    mintPk: PublicKey,
    indexerPayload: unknown,
  ): Promise<{ source: PublicKey; destination: PublicKey; authority: PublicKey }> {
    const observed = extractObservedEndpoints(indexerPayload);
    if (observed) {
      const source = new PublicKey(observed.source);
      let authority: PublicKey = PLACEHOLDER_SOURCE_OWNER;
      try {
        const account = await getAccount(this.connection, source, "confirmed", TOKEN_2022_PROGRAM_ID);
        authority = account.owner;
      } catch {
        // keep the placeholder authority
      }
      return { source, destination: new PublicKey(observed.destination), authority };
    }

    let holders: PublicKey[] = [];
    try {
      const largest = await this.connection.getTokenLargestAccounts(mintPk, "confirmed");
      holders = largest.value.map((v) => v.address);
    } catch {
      holders = [];
    }
    const source =
      holders[0] ??
      getAssociatedTokenAddressSync(mintPk, PLACEHOLDER_SOURCE_OWNER, false, TOKEN_2022_PROGRAM_ID);
    const destination =
      holders.find((h) => !h.equals(source)) ??
      holders[0] ??
      getAssociatedTokenAddressSync(mintPk, PLACEHOLDER_DEST_OWNER, false, TOKEN_2022_PROGRAM_ID);

    let authority: PublicKey = PLACEHOLDER_SOURCE_OWNER;
    try {
      const account = await getAccount(this.connection, source, "confirmed", TOKEN_2022_PROGRAM_ID);
      authority = account.owner;
    } catch {
      // keep the placeholder authority
    }
    return { source, destination, authority };
  }
}
