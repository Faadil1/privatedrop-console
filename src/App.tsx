import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useMutation } from "@tanstack/react-query";
import {
  useAccount,
  useConnect,
  usePublicClient,
  useWalletClient,
  type UseConnectReturnType,
  type UsePublicClientReturnType,
  type UseWalletClientReturnType,
} from "wagmi";
import { ZamaProvider, useZamaSDK } from "@zama-fhe/react-sdk";
import {
  useIsRegistered,
  useRegister,
  usePreflightDisperse,
  useDisperse,
} from "@tokenops/sdk/fhe-disperse/react";
import {
  useConfidentialBalance,
  useUnderlyingBalance,
  useMintConfidential,
} from "@tokenops/sdk/testnet-faucet/react";
import { setOperatorDirect } from "./erc7984-operator";
import {
  getConfidentialTestTokenAddress,
  getTestTokenAddress,
  requireFheDisperseSingletonAddress,
} from "@tokenops/sdk";
import { SEPOLIA_CHAIN_ID } from "./wagmi";
import { buildZamaConfig, adaptZamaEncryptor } from "./zama";

/**
 * PrivateDrop Console — LIVE-RUNNER panel.
 *
 * NOT a final product UI. This is an execution console for Faadil to run the
 * live TokenOps Confidential Disperse spike on Sepolia by hand — connect a
 * real wallet, check registration, preflight a tiny 1-2 recipient batch, and
 * (only on explicit click, only when preflight.ready === true) send a real
 * disperse() transaction.
 *
 * Not in scope here: Vault Room UI, Proof Stamp, marketing copy, final
 * visual design. See SPIKE-RESULT.md Section 10 for exactly what changed.
 */

const DISPERSE_SINGLETON = requireFheDisperseSingletonAddress(SEPOLIA_CHAIN_ID);
const CTTT_ADDRESS = getConfidentialTestTokenAddress(SEPOLIA_CHAIN_ID);
const TTT_ADDRESS = getTestTokenAddress(SEPOLIA_CHAIN_ID);

type EvidenceLabel = "LIVE" | "LOCAL_VERIFIED" | "BLOCKED" | "NOT_USED";

interface EvidenceEntry {
  id: string;
  timestamp: string;
  action: string;
  result: string;
  label: EvidenceLabel;
  txHash?: string;
  raw?: unknown;
}

type LogFn = (entry: Omit<EvidenceEntry, "id" | "timestamp">) => void;

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

export function App() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, error: connectError } = useConnect();
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const { data: walletClient } = useWalletClient({ chainId: SEPOLIA_CHAIN_ID });

  const [log, setLog] = useState<EvidenceEntry[]>([]);

  const logEvent = useCallback<LogFn>((entry) => {
    setLog((prev) => [
      {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
      },
      ...prev,
    ]);
  }, []);

  const onSepolia = chainId === SEPOLIA_CHAIN_ID;
  const runnerReady = isConnected && onSepolia && !!publicClient && !!walletClient && !!address;

  return (
    <div style={{ fontFamily: "monospace", padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <h1>PrivateDrop Console — LIVE-RUNNER</h1>
      <p style={{ opacity: 0.7 }}>
        TokenOps Confidential Disperse. Not WrapHub. Sepolia only. Execution controls, not final UI.
      </p>

      <EnvironmentPanel chainId={chainId} address={address} />

      <WalletPanel
        isConnected={isConnected}
        connect={connect}
        connectors={connectors}
        connectError={connectError}
        onSepolia={onSepolia}
        chainId={chainId}
      />

      {!runnerReady && (
        <p style={{ color: "darkorange" }}>
          Connect a wallet on Sepolia (11155111) to unlock registration / faucet / preflight /
          disperse panels below.
        </p>
      )}

      {runnerReady && publicClient && walletClient && address && (
        <RunnerPanels
          publicClient={publicClient}
          walletClient={walletClient}
          address={address}
          logEvent={logEvent}
        />
      )}

      <EvidenceLogPanel log={log} />
    </div>
  );
}

export default App;

// ---------------------------------------------------------------------------
// 1. Environment panel
// ---------------------------------------------------------------------------

function EnvironmentPanel({ chainId, address }: { chainId?: number; address?: Address }) {
  return (
    <section style={{ marginBottom: 16, border: "1px solid #444", padding: 12 }}>
      <h2>1. Environment</h2>
      <div>Current chain id: {chainId ?? "n/a"}</div>
      <div>Connected wallet: {address ?? "n/a"}</div>
      <div>Expected chain: Sepolia (11155111)</div>
      <div>TokenOps Disperse singleton: {DISPERSE_SINGLETON}</div>
      <div>CTTT token: {CTTT_ADDRESS ?? "NOT RESOLVED"}</div>
      <div>TTT token (underlying): {TTT_ADDRESS ?? "NOT RESOLVED"}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. Wallet / network panel
// ---------------------------------------------------------------------------

function WalletPanel(props: {
  isConnected: boolean;
  connect: UseConnectReturnType["connect"];
  connectors: UseConnectReturnType["connectors"];
  connectError: Error | null;
  onSepolia: boolean;
  chainId?: number;
}) {
  const { address } = useAccount();
  const { isConnected, connect, connectors, connectError, onSepolia, chainId } = props;

  return (
    <section style={{ marginBottom: 16, border: "1px solid #444", padding: 12 }}>
      <h2>2. Wallet / network</h2>
      {!isConnected ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {connectors.map((c) => (
            <button key={c.uid} onClick={() => connect({ connector: c })}>
              Connect {c.name}
            </button>
          ))}
        </div>
      ) : (
        <div>Connected: {address}</div>
      )}
      <div>Chain id: {chainId ?? "n/a"} — {onSepolia ? "✅ Sepolia" : "❌ not Sepolia (all actions blocked)"}</div>
      {connectError && <div style={{ color: "crimson" }}>{connectError.message}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Runner shell — only mounted once wallet + Sepolia are confirmed. Builds a
// real ZamaConfig from the live wagmi clients so useZamaSDK() works inside.
// ---------------------------------------------------------------------------

function RunnerPanels({
  publicClient,
  walletClient,
  address,
  logEvent,
}: {
  publicClient: NonNullable<UsePublicClientReturnType>;
  walletClient: NonNullable<UseWalletClientReturnType["data"]>;
  address: Address;
  logEvent: LogFn;
}) {
  const zamaConfig = useMemo(
    () => buildZamaConfig(publicClient, walletClient),
    [publicClient, walletClient],
  );

  return (
    <ZamaProvider config={zamaConfig}>
      <RegistrationPanel address={address} logEvent={logEvent} />
      <FaucetPanel address={address} logEvent={logEvent} />
      <PreflightAndDispersePanels
        address={address}
        publicClient={publicClient}
        walletClient={walletClient}
        logEvent={logEvent}
      />
    </ZamaProvider>
  );
}

// ---------------------------------------------------------------------------
// 3. Registration panel
// ---------------------------------------------------------------------------

function RegistrationPanel({ address, logEvent }: { address: Address; logEvent: LogFn }) {
  const { data: isRegistered, refetch, isFetching, error } = useIsRegistered({ user: address });
  const register = useRegister();

  useEffect(() => {
    if (isRegistered !== undefined) {
      logEvent({
        action: "isRegistered()",
        result: String(isRegistered),
        label: "LIVE",
        raw: { user: address, isRegistered },
      });
    }
    if (error) {
      logEvent({ action: "isRegistered()", result: error.message, label: "BLOCKED" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRegistered, error]);

  function handleRegister() {
    if (!CTTT_ADDRESS) {
      logEvent({ action: "register()", result: "CTTT address not resolved", label: "BLOCKED" });
      return;
    }
    register.mutate(
      { token: CTTT_ADDRESS },
      {
        onSuccess: (result) => {
          logEvent({
            action: "register()",
            result: `wallets ${result.wallets[0]}, ${result.wallets[1]}`,
            label: "LIVE",
            txHash: result.hash,
            raw: result,
          });
          refetch();
        },
        onError: (err) => {
          logEvent({ action: "register()", result: err.message, label: "BLOCKED" });
        },
      },
    );
  }

  return (
    <section style={{ marginBottom: 16, border: "1px solid #444", padding: 12 }}>
      <h2>3. Registration</h2>
      <button onClick={() => refetch()} disabled={isFetching}>
        {isFetching ? "Checking..." : "Check isRegistered()"}
      </button>
      <div>isRegistered: {isRegistered === undefined ? "unknown" : String(isRegistered)}</div>
      {isRegistered === false && (
        <button onClick={handleRegister} disabled={register.isPending}>
          {register.isPending ? "Sending register() tx..." : "register() — sends a real tx"}
        </button>
      )}
      {register.data && <div>Last register tx: {register.data.hash}</div>}
      {register.isError && <div style={{ color: "crimson" }}>{register.error?.message}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. Faucet / balance panel
// ---------------------------------------------------------------------------

function FaucetPanel({ address, logEvent }: { address: Address; logEvent: LogFn }) {
  const {
    data: confidentialHandle,
    refetch: refetchConfidential,
    error: confidentialError,
  } = useConfidentialBalance({ account: address });
  const {
    data: underlyingBalance,
    refetch: refetchUnderlying,
    error: underlyingError,
  } = useUnderlyingBalance({ account: address });
  const mintConfidential = useMintConfidential();

  function handleMint() {
    // 1.000000 CTTT — CTTT uses 6-decimal units per SDK doc comment.
    mintConfidential.mutate(
      { amount: 1_000_000n },
      {
        onSuccess: (result) => {
          logEvent({
            action: "mintConfidential()",
            result: `minted ${result.amount} (6dp) to ${result.to}, backed by ${result.underlyingMinted} TTT`,
            label: "LIVE",
            txHash: result.hash,
            raw: result,
          });
          refetchConfidential();
          refetchUnderlying();
        },
        onError: (err) => {
          logEvent({ action: "mintConfidential()", result: err.message, label: "BLOCKED" });
        },
      },
    );
  }

  return (
    <section style={{ marginBottom: 16, border: "1px solid #444", padding: 12 }}>
      <h2>4. Faucet / balance</h2>
      <div>
        Underlying TTT balance (raw 18dp units): {underlyingBalance?.toString() ?? "—"}
        {underlyingError && <span style={{ color: "crimson" }}> ({underlyingError.message})</span>}
      </div>
      <div>
        Confidential CTTT balance handle: {confidentialHandle ?? "—"}
        {confidentialError && <span style={{ color: "crimson" }}> ({confidentialError.message})</span>}
      </div>
      <p style={{ opacity: 0.7, fontSize: "0.9em" }}>
        NOTE: the confidential balance is an encrypted handle, not a plaintext number. Decrypting
        it via Zama's userDecrypt is NOT_USED in this spike — out of scope. The handle read itself
        is a real call once executed.
      </p>
      <button onClick={handleMint} disabled={mintConfidential.isPending}>
        {mintConfidential.isPending ? "Minting..." : "mintConfidential(1.0 CTTT) — sends a real tx"}
      </button>
      {mintConfidential.isError && (
        <div style={{ color: "crimson" }}>{mintConfidential.error?.message}</div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// 5 & 6. Preflight + Disperse panels
// ---------------------------------------------------------------------------

function PreflightAndDispersePanels({
  address,
  publicClient,
  walletClient,
  logEvent,
}: {
  address: Address;
  publicClient: NonNullable<UsePublicClientReturnType>;
  walletClient: NonNullable<UseWalletClientReturnType["data"]>;
  logEvent: LogFn;
}) {
  const [recipient1, setRecipient1] = useState("");
  const [recipient2, setRecipient2] = useState("");
  const [amount1, setAmount1] = useState("1");
  const [amount2, setAmount2] = useState("1");
  const [preflightEnabled, setPreflightEnabled] = useState(false);

  const recipients = useMemo(
    () => [recipient1, recipient2].filter((r): r is string => r.trim().length > 0) as Address[],
    [recipient1, recipient2],
  );
  const amounts = useMemo(() => {
    const raw = [amount1, amount2].slice(0, recipients.length);
    return raw.map((a) => {
      try {
        return BigInt(a || "0");
      } catch {
        return 0n;
      }
    });
  }, [amount1, amount2, recipients.length]);

  const preflightArgsReady = preflightEnabled && recipients.length > 0 && !!CTTT_ADDRESS;

  const preflight = usePreflightDisperse({
    user: preflightArgsReady ? address : undefined,
    token: preflightArgsReady ? CTTT_ADDRESS : undefined,
    recipients: preflightArgsReady ? recipients : undefined,
    amounts: preflightArgsReady ? amounts : undefined,
    mode: "direct",
  });

  useEffect(() => {
    if (preflight.data) {
      logEvent({
        action: "preflightDisperse()",
        result: `ready=${preflight.data.ready}, blockers=[${preflight.data.blockers.join("; ")}]`,
        label: "LIVE",
        raw: preflight.data,
      });
    }
    if (preflight.error) {
      logEvent({ action: "preflightDisperse()", result: preflight.error.message, label: "BLOCKED" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preflight.data, preflight.error]);

  // ---------------------------------------------------------------------
  // 5b. Approval — token.setOperator(DISPERSE_SINGLETON, farFutureDeadline)
  //
  // Confirmed from installed @tokenops/sdk/fhe/operators.d.ts (NOT guessed):
  // preflightDisperse's "direct" mode blocker
  // ("Sender has not approved the singleton as operator on the token") is
  // computed by reading ERC7984_IS_OPERATOR_ABI.isOperator(user, singleton)
  // on the token (see @tokenops/sdk chunk-FXCW7LVB.js preflightDisperse
  // implementation). The exact, documented write-side counterpart is
  // `setOperator()` from `@tokenops/sdk/fhe`, calling the real ERC-7984
  // selector `setOperator(address operator, uint48 until)` on the token.
  //
  // BUT: importing `@tokenops/sdk/fhe` directly fails the production build
  // — its barrel has a top-level import of `SepoliaConfig`/`MainnetConfig`
  // from `@zama-fhe/sdk`, which don't exist in the installed 3.2.0 (removed
  // between 3.0.0 and 3.2.0, inside @tokenops/sdk's own declared ^3.0.0 peer
  // range). See `src/erc7984-operator.ts` for the verbatim-copied
  // workaround and full discovery notes (SPIKE-RESULT.md Section 12).
  // ---------------------------------------------------------------------
  const approveOperator = useMutation({
    mutationFn: async () => {
      if (!CTTT_ADDRESS) throw new Error("CTTT address not resolved");
      return setOperatorDirect({
        publicClient,
        walletClient,
        token: CTTT_ADDRESS,
        spender: DISPERSE_SINGLETON,
        // deadline omitted -> defaults to ERC7984_OPERATOR_MAX_DEADLINE
      });
    },
    onSuccess: (hash) => {
      logEvent({
        action: "setOperator()",
        result: `approved ${DISPERSE_SINGLETON} as CTTT operator`,
        label: "LIVE",
        txHash: hash,
        raw: { hash, token: CTTT_ADDRESS, spender: DISPERSE_SINGLETON },
      });
      // Re-run preflightDisperse() to confirm hasApprovedSingleton flips true.
      preflight.refetch();
    },
    onError: (err) => {
      logEvent({ action: "setOperator()", result: err.message, label: "BLOCKED" });
    },
  });

  // NOTE: @tokenops/sdk's doc comment says `encryptor: () => zamaSDK.relayer`
  // directly. That does not type-check against the installed
  // @zama-fhe/sdk@3.2.0 (hex-string EncryptResult vs. the Uint8Array-based
  // Encryptor interface @tokenops/sdk expects) — see zama.ts
  // `adaptZamaEncryptor` for the exact discovered mismatch and the
  // standard hex->bytes bridge used here. UNVERIFIED at runtime — see
  // SPIKE-RESULT.md Section 10.
  const zamaSDK = useZamaSDK();
  const disperse = useDisperse({ encryptor: () => adaptZamaEncryptor(zamaSDK) });

  function handleDisperse() {
    if (!preflight.data?.ready || !CTTT_ADDRESS) return;
    disperse.mutate(
      { token: CTTT_ADDRESS, mode: "direct", recipients, amounts },
      {
        onSuccess: (result) => {
          logEvent({
            action: "disperse()",
            result: `tx ${result.hash}`,
            label: "LIVE",
            txHash: result.hash,
            raw: result,
          });
        },
        onError: (err) => {
          logEvent({ action: "disperse()", result: err.message, label: "BLOCKED" });
        },
      },
    );
  }

  return (
    <>
      <section style={{ marginBottom: 16, border: "1px solid #444", padding: 12 }}>
        <h2>5. Preflight (direct mode, 1-2 recipients)</h2>
        <div>
          Recipient 1:{" "}
          <input value={recipient1} onChange={(e) => setRecipient1(e.target.value)} placeholder="0x..." size={44} />
          {" "}Amount 1 (raw uint64 units):{" "}
          <input value={amount1} onChange={(e) => setAmount1(e.target.value)} size={8} />
        </div>
        <div>
          Recipient 2 (optional):{" "}
          <input value={recipient2} onChange={(e) => setRecipient2(e.target.value)} placeholder="0x..." size={44} />
          {" "}Amount 2:{" "}
          <input value={amount2} onChange={(e) => setAmount2(e.target.value)} size={8} />
        </div>
        <div>Mode: direct (fixed for this spike)</div>
        <button onClick={() => setPreflightEnabled(true)} disabled={recipients.length === 0}>
          Run preflightDisperse()
        </button>
        {preflight.data && (
          <>
            <div>ready: {String(preflight.data.ready)}</div>
            <div>
              blockers: {preflight.data.blockers.length ? preflight.data.blockers.join("; ") : "none"}
            </div>
            <pre style={{ background: "#111", color: "#0f0", padding: 8, overflow: "auto", maxHeight: 240 }}>
              {JSON.stringify(preflight.data, bigintReplacer, 2)}
            </pre>
          </>
        )}
        {preflight.isError && <div style={{ color: "crimson" }}>{preflight.error?.message}</div>}
      </section>

      {preflight.data && (
        <section style={{ marginBottom: 16, border: "1px solid #444", padding: 12 }}>
          <h2>5b. Approval</h2>
          <div>
            hasApprovedSingleton (from last preflight):{" "}
            {preflight.data.hasApprovedSingleton === null
              ? "n/a (not direct mode)"
              : String(preflight.data.hasApprovedSingleton)}
          </div>
          {preflight.data.hasApprovedSingleton === false && (
            <button onClick={() => approveOperator.mutate()} disabled={approveOperator.isPending}>
              {approveOperator.isPending
                ? "Sending setOperator() tx..."
                : "Approve TokenOps singleton as CTTT operator"}
            </button>
          )}
          {approveOperator.data && <div>Last approval tx: {approveOperator.data}</div>}
          {approveOperator.isError && (
            <div style={{ color: "crimson" }}>{approveOperator.error?.message}</div>
          )}
        </section>
      )}

      <section style={{ marginBottom: 16, border: "1px solid #444", padding: 12 }}>
        <h2>6. Disperse</h2>
        <div style={{ opacity: 0.7, fontSize: "0.9em" }}>
          Enabled only when preflight.ready === true. Never auto-sends — requires this explicit click.
        </div>
        <button onClick={handleDisperse} disabled={!preflight.data?.ready || disperse.isPending}>
          {disperse.isPending ? "Sending disperse() tx..." : "Execute disperse() — sends a real tx"}
        </button>
        {disperse.data && (
          <pre style={{ background: "#111", color: "#0f0", padding: 8, overflow: "auto", maxHeight: 240 }}>
            {JSON.stringify(disperse.data, bigintReplacer, 2)}
          </pre>
        )}
        {disperse.isError && <div style={{ color: "crimson" }}>{disperse.error?.message}</div>}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// 7. Evidence log panel
// ---------------------------------------------------------------------------

function EvidenceLogPanel({ log }: { log: EvidenceEntry[] }) {
  function copyRaw(entry: EvidenceEntry) {
    void navigator.clipboard?.writeText(JSON.stringify(entry, bigintReplacer, 2));
  }

  return (
    <section style={{ marginBottom: 16, border: "1px solid #444", padding: 12 }}>
      <h2>7. Evidence log</h2>
      {log.length === 0 ? (
        <div>No actions executed yet.</div>
      ) : (
        <table style={{ width: "100%", fontSize: "0.85em", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th>Time</th>
              <th>Action</th>
              <th>Label</th>
              <th>Result</th>
              <th>Tx hash</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {log.map((entry) => (
              <tr key={entry.id} style={{ borderTop: "1px solid #333" }}>
                <td>{entry.timestamp}</td>
                <td>{entry.action}</td>
                <td>{entry.label}</td>
                <td>{entry.result}</td>
                <td>{entry.txHash ?? "—"}</td>
                <td>
                  <button onClick={() => copyRaw(entry)}>Copy JSON</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
