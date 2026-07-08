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
 * PrivateDrop Console — Sepolia Execution Console.
 *
 * Execution console for the live TokenOps Confidential Disperse flow on
 * Sepolia — connect a real wallet, check registration, preflight a tiny 1-2
 * recipient batch, and (only on explicit click, only when
 * preflight.ready === true) send a real disperse() transaction.
 *
 * This is the execution surface. The proof surface is docs/index.html
 * (the Verifiable Seismograph proof UI).
 *
 * Not in scope: Vault Room UI, Proof Stamp, final visual design.
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

function labelClass(label: EvidenceLabel): string {
  switch (label) {
    case "LIVE": return "tag tag-live";
    case "LOCAL_VERIFIED": return "tag tag-lv";
    case "BLOCKED": return "tag tag-blocked";
    case "NOT_USED": return "tag tag-not-used";
  }
}

// ---------------------------------------------------------------------------
// Step indicators
// ---------------------------------------------------------------------------

const STEPS = [
  { num: 1, label: "Connect" },
  { num: 2, label: "Register" },
  { num: 3, label: "Mint" },
  { num: 4, label: "Approve" },
  { num: 5, label: "Preflight" },
  { num: 6, label: "Disperse" },
  { num: 7, label: "Evidence" },
];

function StepNav({ currentStep }: { currentStep: number }) {
  return (
    <nav className="step-nav" aria-label="Execution steps">
      {STEPS.map((step, i) => (
        <span key={step.num} style={{ display: "contents" }}>
          {i > 0 && <span className="step-connector" />}
          <span
            className={`step-dot${step.num < currentStep ? " done" : ""}${step.num === currentStep ? " active" : ""}`}
            title={step.label}
            aria-label={`Step ${step.num}: ${step.label}`}
          >
            {step.num}
          </span>
        </span>
      ))}
    </nav>
  );
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

  // Determine current step for the step indicator
  const currentStep = !isConnected ? 1 : !onSepolia ? 1 : 2;

  return (
    <>
      {/* Console header */}
      <header className="console-header">
        <span className="eyebrow">
          TokenOps Confidential Disperse &nbsp;·&nbsp; Sepolia Execution Console
        </span>
        <h1>PrivateDrop Console</h1>
        <p className="subtitle">
          Sepolia testnet &nbsp;·&nbsp; CTTT test token &nbsp;·&nbsp; Not mainnet, not production
        </p>
        <a href="../" className="back-link">
          ← Back to Verifiable Seismograph proof
        </a>
      </header>

      <StepNav currentStep={runnerReady ? 3 : currentStep} />

      {/* 01 — Environment */}
      <EnvironmentPanel chainId={chainId} address={address} />

      {/* 02 — Wallet / network */}
      <WalletPanel
        isConnected={isConnected}
        connect={connect}
        connectors={connectors}
        connectError={connectError}
        onSepolia={onSepolia}
        chainId={chainId}
      />

      {!runnerReady && (
        <div className="panel">
          <p className="warn-msg">
            Connect a wallet on Sepolia (11155111) to unlock registration, faucet,
            preflight, and disperse panels below.
          </p>
        </div>
      )}

      {runnerReady && publicClient && walletClient && address && (
        <RunnerPanels
          publicClient={publicClient}
          walletClient={walletClient}
          address={address}
          logEvent={logEvent}
        />
      )}

      {/* Scope boundary / limitations */}
      <BoundaryPanel />

      {/* Evidence log */}
      <EvidenceLogPanel log={log} />

      <p className="memory-line">The amount stayed sealed. The proof didn't.</p>
    </>
  );
}

export default App;

// ---------------------------------------------------------------------------
// 01. Environment panel
// ---------------------------------------------------------------------------

function EnvironmentPanel({ chainId, address }: { chainId?: number; address?: Address }) {
  return (
    <section>
      <div className="section-label">01 &nbsp;Environment</div>
      <div className="panel">
        <div className="panel-row">
          <span className="panel-key">Current chain id</span>
          <span className="panel-value">{chainId ?? "not connected"}</span>
        </div>
        <div className="panel-row">
          <span className="panel-key">Connected wallet</span>
          <span className="panel-value">{address ?? "not connected"}</span>
        </div>
        <div className="panel-row">
          <span className="panel-key">Expected chain</span>
          <span className="panel-value">Sepolia (11155111)</span>
        </div>
        <div className="panel-row">
          <span className="panel-key">TokenOps Disperse singleton</span>
          <span className="panel-value">{DISPERSE_SINGLETON}</span>
        </div>
        <div className="panel-row">
          <span className="panel-key">CTTT token</span>
          <span className="panel-value">{CTTT_ADDRESS ?? "NOT RESOLVED"}</span>
        </div>
        <div className="panel-row">
          <span className="panel-key">TTT token (underlying)</span>
          <span className="panel-value">{TTT_ADDRESS ?? "NOT RESOLVED"}</span>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 02. Wallet / network panel
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
    <section>
      <div className="section-label">02 &nbsp;Connect wallet</div>
      <div className="panel">
        {!isConnected ? (
          <div className="connector-group">
            {connectors.map((c) => (
              <button key={c.uid} className="btn" onClick={() => connect({ connector: c })}>
                Connect {c.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="panel-row">
            <span className="panel-key">Connected</span>
            <span className="panel-value">{address}</span>
          </div>
        )}
        <div className="panel-row" style={{ marginTop: 8 }}>
          <span className="panel-key">Chain</span>
          <span className="panel-value">
            {chainId ?? "n/a"} —{" "}
            {onSepolia ? (
              <span className="tag tag-live">Sepolia ✓</span>
            ) : (
              <span className="tag tag-blocked">Not Sepolia</span>
            )}
          </span>
        </div>
        {connectError && <div className="error-msg">{connectError.message}</div>}
      </div>
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
// 03. Registration panel
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
    <section>
      <div className="section-label">03 &nbsp;Registration</div>
      <div className="panel">
        <h2>
          isRegistered()
          {isRegistered !== undefined && (
            <span className={isRegistered ? "tag tag-live" : "tag tag-blocked"}>
              {isRegistered ? "REGISTERED" : "NOT REGISTERED"}
            </span>
          )}
        </h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Checking…" : "Check isRegistered()"}
          </button>
          {isRegistered === false && (
            <button className="btn btn-primary" onClick={handleRegister} disabled={register.isPending}>
              {register.isPending ? "Sending register() tx…" : "Register — sends a real tx"}
            </button>
          )}
        </div>
        {register.data && (
          <div className="panel-row" style={{ marginTop: 8 }}>
            <span className="panel-key">Last register tx</span>
            <span className="panel-value">{register.data.hash}</span>
          </div>
        )}
        {register.isError && <div className="error-msg">{register.error?.message}</div>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 04. Faucet / balance panel
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
    <section>
      <div className="section-label">04 &nbsp;Mint CTTT</div>
      <div className="panel">
        <h2>Faucet / Balance</h2>
        <div className="panel-row">
          <span className="panel-key">Underlying TTT balance (raw 18dp)</span>
          <span className="panel-value">
            {underlyingBalance?.toString() ?? "—"}
            {underlyingError && <span className="error-msg"> ({underlyingError.message})</span>}
          </span>
        </div>
        <div className="panel-row">
          <span className="panel-key">Confidential CTTT balance handle</span>
          <span className="panel-value">
            {confidentialHandle ?? "—"}
            {confidentialError && <span className="error-msg"> ({confidentialError.message})</span>}
          </span>
        </div>
        <p className="info-note" style={{ margin: "10px 0" }}>
          The confidential balance is an encrypted handle, not a plaintext number. Decrypting
          it via Zama's userDecrypt is <span className="tag tag-not-used">NOT_USED</span> in this
          build — out of scope. The handle read itself is a real call once executed.
        </p>
        <button className="btn btn-primary" onClick={handleMint} disabled={mintConfidential.isPending}>
          {mintConfidential.isPending ? "Minting…" : "Mint 1.0 CTTT — sends a real tx"}
        </button>
        {mintConfidential.isError && (
          <div className="error-msg">{mintConfidential.error?.message}</div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 05 & 06. Preflight + Disperse panels
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

  // -----------------------------------------------------------------------
  // 05b. Approval — token.setOperator(DISPERSE_SINGLETON, farFutureDeadline)
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
  // -----------------------------------------------------------------------
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
      {/* 05. Preflight */}
      <section>
        <div className="section-label">05 &nbsp;Preflight (direct mode, 1–2 recipients)</div>
        <div className="panel">
          <div className="input-row">
            <span className="input-label">Recipient 1</span>
            <input
              className="field-input"
              value={recipient1}
              onChange={(e) => setRecipient1(e.target.value)}
              placeholder="0x…"
              size={44}
            />
            <span className="input-label">Amount (raw uint64)</span>
            <input
              className="field-input"
              value={amount1}
              onChange={(e) => setAmount1(e.target.value)}
              size={8}
            />
          </div>
          <div className="input-row">
            <span className="input-label">Recipient 2</span>
            <input
              className="field-input"
              value={recipient2}
              onChange={(e) => setRecipient2(e.target.value)}
              placeholder="0x… (optional)"
              size={44}
            />
            <span className="input-label">Amount</span>
            <input
              className="field-input"
              value={amount2}
              onChange={(e) => setAmount2(e.target.value)}
              size={8}
            />
          </div>
          <p className="info-note">Mode: direct (fixed for this execution)</p>
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn" onClick={() => setPreflightEnabled(true)} disabled={recipients.length === 0}>
              Run preflightDisperse()
            </button>
            {preflight.data && (
              <span className={preflight.data.ready ? "tag tag-live" : "tag tag-blocked"}>
                {preflight.data.ready ? "READY" : "NOT READY"}
              </span>
            )}
          </div>
          {preflight.data && (
            <>
              <div className="panel-row" style={{ marginTop: 10 }}>
                <span className="panel-key">ready</span>
                <span className="panel-value">{String(preflight.data.ready)}</span>
              </div>
              <div className="panel-row">
                <span className="panel-key">blockers</span>
                <span className="panel-value">
                  {preflight.data.blockers.length ? preflight.data.blockers.join("; ") : "none"}
                </span>
              </div>
              <div className="raw-output">
                {JSON.stringify(preflight.data, bigintReplacer, 2)}
              </div>
            </>
          )}
          {preflight.isError && <div className="error-msg">{preflight.error?.message}</div>}
        </div>
      </section>

      {/* 05b. Approval */}
      {preflight.data && (
        <section>
          <div className="section-label">05b &nbsp;Approve TokenOps singleton</div>
          <div className="panel">
            <h2>
              setOperator()
              {preflight.data.hasApprovedSingleton !== null && (
                <span className={preflight.data.hasApprovedSingleton ? "tag tag-live" : "tag tag-blocked"}>
                  {preflight.data.hasApprovedSingleton ? "APPROVED" : "NOT APPROVED"}
                </span>
              )}
            </h2>
            <div className="panel-row">
              <span className="panel-key">hasApprovedSingleton</span>
              <span className="panel-value">
                {preflight.data.hasApprovedSingleton === null
                  ? "n/a (not direct mode)"
                  : String(preflight.data.hasApprovedSingleton)}
              </span>
            </div>
            {preflight.data.hasApprovedSingleton === false && (
              <div style={{ marginTop: 10 }}>
                <button className="btn btn-primary" onClick={() => approveOperator.mutate()} disabled={approveOperator.isPending}>
                  {approveOperator.isPending
                    ? "Sending setOperator() tx…"
                    : "Approve TokenOps singleton as CTTT operator"}
                </button>
              </div>
            )}
            {approveOperator.data && (
              <div className="panel-row" style={{ marginTop: 8 }}>
                <span className="panel-key">Last approval tx</span>
                <span className="panel-value">{approveOperator.data}</span>
              </div>
            )}
            {approveOperator.isError && (
              <div className="error-msg">{approveOperator.error?.message}</div>
            )}
          </div>
        </section>
      )}

      {/* 06. Disperse */}
      <section>
        <div className="section-label">06 &nbsp;Execute disperse</div>
        <div className="panel">
          <h2>disperse() <span className="tag tag-live">LIVE TX</span></h2>
          <p className="info-note" style={{ marginBottom: 10 }}>
            Enabled only when preflight.ready === true. Never auto-sends — requires explicit click.
          </p>
          <button
            className="btn btn-primary"
            onClick={handleDisperse}
            disabled={!preflight.data?.ready || disperse.isPending}
          >
            {disperse.isPending ? "Sending disperse() tx…" : "Execute disperse() — sends a real tx"}
          </button>
          {disperse.data && (
            <div className="raw-output">
              {JSON.stringify(disperse.data, bigintReplacer, 2)}
            </div>
          )}
          {disperse.isError && <div className="error-msg">{disperse.error?.message}</div>}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Scope boundary / limitations
// ---------------------------------------------------------------------------

function BoundaryPanel() {
  return (
    <section>
      <div className="section-label">Scope boundary</div>
      <div className="boundary-panel">
        <h2>⚠ Limitations — read before judging</h2>
        <div className="boundary-item">
          <span className="boundary-bullet">▸</span>
          <span>recipientDecrypt() is NOT IMPLEMENTED in this build</span>
        </div>
        <div className="boundary-item">
          <span className="boundary-bullet">▸</span>
          <span>Recipient addresses are masked in UI only — not a cryptographic privacy claim</span>
        </div>
        <div className="boundary-item">
          <span className="boundary-bullet">▸</span>
          <span>Sepolia testnet — not mainnet</span>
        </div>
        <div className="boundary-item">
          <span className="boundary-bullet">▸</span>
          <span>CTTT test token — not a production asset</span>
        </div>
      </div>
      <div className="lv-notice">
        <span className="tag tag-lv" style={{ marginRight: 8 }}>LOCAL_VERIFIED</span>
        <span className="lv-notice-text">
          Sender-authorized recipient reveal path is LOCAL_VERIFIED, but not live-tested in this submission.
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 07. Evidence log panel
// ---------------------------------------------------------------------------

function EvidenceLogPanel({ log }: { log: EvidenceEntry[] }) {
  function copyRaw(entry: EvidenceEntry) {
    void navigator.clipboard?.writeText(JSON.stringify(entry, bigintReplacer, 2));
  }

  return (
    <section>
      <div className="section-label">07 &nbsp;Evidence log</div>
      <div className="panel">
        {log.length === 0 ? (
          <p className="info-note">No actions executed yet. Connect a wallet and run steps above to populate this log.</p>
        ) : (
          <table className="evidence-table">
            <thead>
              <tr>
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
                <tr key={entry.id}>
                  <td>{entry.timestamp.slice(11, 19)}</td>
                  <td>{entry.action}</td>
                  <td><span className={labelClass(entry.label)}>{entry.label}</span></td>
                  <td>{entry.result}</td>
                  <td>{entry.txHash ? `${entry.txHash.slice(0, 10)}…` : "—"}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => copyRaw(entry)}>Copy</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
