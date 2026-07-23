// Unit tests for the pure, network-free parts of @hukt-labs/resolver: endpoint
// construction and attestation extraction from a captured indexer payload.
// The captured payload mirrors the live shape of GET https://api.hukt.fun/hooks/{mint}.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_URL,
  extractAttestation,
  hookEndpoint,
  isoToUnixSeconds,
} from "../src/index";

const MINT = "6rEQuznf2awpSEnrC8DsPbqq6cAHN3Vkk6xRRoYL9V29";
const PROGRAM = "4q7Tgd9A1XfTB2i6WLUjmFXNocw6GrshZwcKgarGV9aC";

// Captured (and trimmed) from the live devnet indexer on 2026-07-25.
const INDEXER_PAYLOAD = {
  mint: MINT,
  hooks: [
    {
      programId: PROGRAM,
      presets: ["royalty"],
      active: true,
      signal: "conditional",
      attested: true,
      attestation: {
        authority: "472iAFz5YD3mNpmp4TKSVuksm9rYjXHYmqLkfs3rpjzt",
        timestamp: "2026-07-12T03:29:13+00:00",
        level: "safe",
      },
      extraAccountMetas: [],
      executions: [],
    },
  ],
  summary: { totalTransfers: 5, hookedTransfers: 5, lastSlot: 475663391 },
};

describe("hookEndpoint", () => {
  it("uses the default API base", () => {
    expect(hookEndpoint({ rpcUrl: "" }, MINT)).toBe(`${DEFAULT_API_URL}/hooks/${MINT}`);
  });

  it("strips trailing slashes from a custom base", () => {
    expect(hookEndpoint({ rpcUrl: "", apiUrl: "https://example.com///" }, MINT)).toBe(
      `https://example.com/hooks/${MINT}`,
    );
  });
});

describe("isoToUnixSeconds", () => {
  it("converts the indexer's ISO timestamps", () => {
    expect(isoToUnixSeconds("2026-07-12T03:29:13+00:00")).toBe(1783826953);
  });

  it("returns null for junk", () => {
    expect(isoToUnixSeconds("not-a-date")).toBeNull();
  });
});

describe("extractAttestation", () => {
  it("finds the attestation for the hook program", () => {
    const verdict = extractAttestation(INDEXER_PAYLOAD, PROGRAM);
    expect(verdict).toEqual({
      attested: true,
      attestation: {
        authority: "472iAFz5YD3mNpmp4TKSVuksm9rYjXHYmqLkfs3rpjzt",
        timestamp: 1783826953,
        level: "safe",
      },
    });
  });

  it("is undefined when the program is not in the payload", () => {
    expect(extractAttestation(INDEXER_PAYLOAD, "SomeOtherProgram1111111111111111111111111111")).toBeUndefined();
  });

  it("reports unattested hooks without fabricating an attestation", () => {
    const payload = {
      hooks: [{ programId: PROGRAM, attested: false, attestation: null }],
    };
    expect(extractAttestation(payload, PROGRAM)).toEqual({ attested: false, attestation: null });
  });

  it("is undefined for malformed payloads", () => {
    expect(extractAttestation(null, PROGRAM)).toBeUndefined();
    expect(extractAttestation({ hooks: "nope" }, PROGRAM)).toBeUndefined();
  });
});
