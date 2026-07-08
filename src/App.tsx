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

function maskAddress(addr: string): string {
  if (!addr) return "—";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function maskHexAddresses(text: string): string {
  if (!text) return "";
  return text.replace(/0x[a-fA-F0-9]{40}/gi, (match) => maskAddress(match));
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
  { num: 1, label: "Env" },
  { num: 2, label: "Connect" },
  { num: 3, label: "Compose" },
  { num: 4, label: "Readiness" },
  { num: 5, label: "Preflight" },
  { num: 6, label: "Approve" },
  { num: 7, label: "Disperse" },
  { num: 8, label: "Receipt" },
  { num: 9, label: "Reveal" },
  { num: 10, label: "Evidence" },
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

  // Determine current step for the step indicator based on log events
  const currentStep = useMemo(() => {
    if (!isConnected || !onSepolia) return 2;
    const actions = new Set(log.map(e => e.action));
    if (actions.has("disperse()")) return 8; // receipt
    if (actions.has("preflightDisperse()")) return 7; // disperse execution
    if (actions.has("setOperator()")) return 6; // disperse or approve
    if (actions.has("mintConfidential()")) return 4; // readiness
    if (actions.has("isRegistered()")) return 4; // readiness
    return 3; // compose
  }, [isConnected, onSepolia, log]);

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

      <StepNav currentStep={currentStep} />

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

      {/* 09 — Recipient Reveal Path */}
      <RecipientRevealPanel />

      {/* 10 — Evidence log */}
      <EvidenceLogPanel log={log} />

      {/* 11 — Scope boundary / limitations */}
      <BoundaryPanel />

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
          <span className="panel-value">{address ? maskAddress(address) : "not connected"}</span>
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
          <>
            <div className="panel-row">
              <span className="panel-key">Signing wallet / sender</span>
              <span className="panel-value">{address ? maskAddress(address) : "—"}</span>
            </div>
            <p className="info-note" style={{ marginTop: 8 }}>
              The connected wallet signs the transaction. Recipients are entered separately below.
            </p>
          </>
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

  const [recipient1, setRecipient1] = useState("");
  const [recipient2, setRecipient2] = useState("");
  const [amount1, setAmount1] = useState("1");
  const [amount2, setAmount2] = useState("1");
  const [disperseTxHash, setDisperseTxHash] = useState<string | null>(null);

  return (
    <ZamaProvider config={zamaConfig}>
      {/* 03. Composer / Recipient List */}
      <ComposerPanel
        recipient1={recipient1}
        setRecipient1={setRecipient1}
        recipient2={recipient2}
        setRecipient2={setRecipient2}
        amount1={amount1}
        setAmount1={setAmount1}
        amount2={amount2}
        setAmount2={setAmount2}
      />

      {/* 04. Readiness Gate */}
      <RegistrationPanel address={address} logEvent={logEvent} />
      <FaucetPanel address={address} logEvent={logEvent} />

      {/* 05, 06. Preflight + Disperse */}
      <PreflightAndDispersePanels
        address={address}
        publicClient={publicClient}
        walletClient={walletClient}
        logEvent={logEvent}
        recipient1={recipient1}
        recipient2={recipient2}
        amount1={amount1}
        amount2={amount2}
        setDisperseTxHash={setDisperseTxHash}
      />

      {/* 08. Sealed Receipt */}
      <SealedReceiptPanel
        txHash={disperseTxHash}
        recipient1={recipient1}
        recipient2={recipient2}
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
      <div className="section-label">04 &nbsp;Readiness Gate - Registration</div>
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
      <div className="section-label">04 &nbsp;Readiness Gate - Faucet / Balance</div>
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
          Faucet mint is for the connected signing wallet so it can fund the confidential disperse test. Do not use this wallet as recipient automatically. The confidential balance is an encrypted handle, not a plaintext number. Decrypting it via Zama's userDecrypt is <span className="tag tag-not-used">NOT_USED</span> in this build.
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

interface PreflightAndDispersePanelsProps {
  address: Address;
  publicClient: NonNullable<UsePublicClientReturnType>;
  walletClient: NonNullable<UseWalletClientReturnType["data"]>;
  logEvent: LogFn;
  recipient1: string;
  recipient2: string;
  amount1: string;
  amount2: string;
  setDisperseTxHash: (hash: string | null) => void;
}

function PreflightAndDispersePanels({
  address,
  publicClient,
  walletClient,
  logEvent,
  recipient1,
  recipient2,
  amount1,
  amount2,
  setDisperseTxHash,
}: PreflightAndDispersePanelsProps) {
  const [preflightEnabled, setPreflightEnabled] = useState(false);

  const isValidAddress = (addr: string) => /^0x[a-fA-F0-9]{40}$/.test(addr.trim());

  const hasInvalidRecipient = useMemo(() => {
    const r1 = recipient1.trim();
    const r2 = recipient2.trim();
    if (r1.length > 0 && !isValidAddress(r1)) return true;
    if (r2.length > 0 && !isValidAddress(r2)) return true;
    return false;
  }, [recipient1, recipient2]);

  const hasNoRecipients = useMemo(() => {
    return recipient1.trim().length === 0 && recipient2.trim().length === 0;
  }, [recipient1, recipient2]);

  const isInputInvalid = hasNoRecipients || hasInvalidRecipient;

  const recipients = useMemo(
    () => [recipient1, recipient2].filter((r): r is string => r.trim().length > 0 && isValidAddress(r)) as Address[],
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

  const preflightArgsReady = preflightEnabled && !isInputInvalid && !!CTTT_ADDRESS;

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
        result: `ready=${preflight.data.ready}, hasApprovedSingleton=${preflight.data.hasApprovedSingleton}`,
        label: "LIVE",
        raw: preflight.data,
      });
    }
    if (preflight.error) {
      logEvent({ action: "preflightDisperse()", result: preflight.error.message, label: "BLOCKED" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preflight.data, preflight.error]);

  const approveOperator = useMutation({
    mutationFn: async () => {
      if (!CTTT_ADDRESS) throw new Error("CTTT address not resolved");
      return setOperatorDirect({
        publicClient,
        walletClient,
        token: CTTT_ADDRESS,
        spender: DISPERSE_SINGLETON,
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
      preflight.refetch();
    },
    onError: (err) => {
      logEvent({ action: "setOperator()", result: err.message, label: "BLOCKED" });
    },
  });

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
          setDisperseTxHash(result.hash);
        },
        onError: (err) => {
          logEvent({ action: "disperse()", result: err.message, label: "BLOCKED" });
        },
      },
    );
  }

  return (
    <>
      {/* 05. Seal / Preflight */}
      <section>
        <div className="section-label">05 &nbsp;Seal / Preflight</div>
        <div className="panel">
          <h2>Seal / Preflight</h2>
          <p className="info-note" style={{ marginBottom: 12 }}>
            Preflight checks whether this recipient list can be sealed into a TokenOps Confidential Disperse transaction.
          </p>
          <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn" onClick={() => setPreflightEnabled(true)} disabled={isInputInvalid}>
              Run preflightDisperse()
            </button>
            {preflight.data && (
              <span className={preflight.data.ready ? "tag tag-live" : "tag tag-blocked"}>
                {preflight.data.ready ? "READY" : "NOT READY"}
              </span>
            )}
          </div>
          {isInputInvalid && (
            <p className="warn-msg" style={{ marginTop: 8 }}>
              Enter recipient addresses to continue.
            </p>
          )}
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

      {/* 06. Approval */}
      {preflight.data && (
        <section>
          <div className="section-label">06 &nbsp;Approval</div>
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

      {/* 07. Execute disperse */}
      <section>
        <div className="section-label">07 &nbsp;Execute disperse</div>
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
          <span>Wallet and recipient addresses are masked for display only. This is not a cryptographic privacy claim.</span>
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
// 09. Recipient Reveal Path panel
// ---------------------------------------------------------------------------

function RecipientRevealPanel() {
  return (
    <section>
      <div className="section-label">09 &nbsp;Recipient Reveal Path</div>
      <div className="panel">
        <h2>Recipient Reveal Path <span className="tag tag-lv">LOCAL_VERIFIED</span></h2>
        <div className="panel-row">
          <span className="panel-key">Reveal Verification Mode</span>
          <span className="panel-value">LOCAL_VERIFIED (simulation only)</span>
        </div>
        <div className="panel-row">
          <span className="panel-key">Onchain Decryption status</span>
          <span className="panel-value" style={{ color: "var(--amber-fg)" }}>recipientDecrypt() not implemented</span>
        </div>
        <p className="info-note" style={{ marginTop: 8 }}>
          Under the honest limitations framework, the recipient reveal path is validated via local deterministic signatures. It is not live-tested on Sepolia in this build.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 10. Evidence log panel
// ---------------------------------------------------------------------------

function EvidenceLogPanel({ log }: { log: EvidenceEntry[] }) {
  function copyRaw(entry: EvidenceEntry) {
    void navigator.clipboard?.writeText(JSON.stringify(entry, bigintReplacer, 2));
  }

  return (
    <section>
      <div className="section-label">10 &nbsp;Evidence log</div>
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
                  <td>{entry.result ? maskHexAddresses(entry.result) : ""}</td>
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

// ---------------------------------------------------------------------------
// Composer / Recipient List panel
// ---------------------------------------------------------------------------

interface ComposerPanelProps {
  recipient1: string;
  setRecipient1: (val: string) => void;
  recipient2: string;
  setRecipient2: (val: string) => void;
  amount1: string;
  setAmount1: (val: string) => void;
  amount2: string;
  setAmount2: (val: string) => void;
}

function ComposerPanel({
  recipient1,
  setRecipient1,
  recipient2,
  setRecipient2,
  amount1,
  setAmount1,
  amount2,
  setAmount2,
}: ComposerPanelProps) {
  function handleClear() {
    setRecipient1("");
    setRecipient2("");
    setAmount1("1");
    setAmount2("1");
  }

  function handleLoadDemo() {
    setRecipient1("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
    setRecipient2("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC");
    setAmount1("1");
    setAmount2("1");
  }

  return (
    <section>
      <div className="section-label">03 &nbsp;Composer / Recipient List</div>
      <div className="panel">
        <h2>Composer / Recipient List</h2>
        <div style={{ marginBottom: 10, fontSize: "11px", color: "var(--ink-mid)" }}>
          Enter the destination addresses for the confidential transfer.
        </div>
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

        <div style={{ marginTop: 12, padding: "8px 12px", border: "1px dashed var(--rule)", borderRadius: "2px" }}>
          <div style={{ fontSize: "11px", color: "var(--ink-faint)", lineHeight: "1.4" }}>
            <strong>Recipients preview (display only):</strong>
            <div style={{ fontFamily: "monospace", marginTop: 4 }}>
              <div>Recipient 1: {maskAddress(recipient1)}</div>
              <div>Recipient 2: {maskAddress(recipient2)}</div>
            </div>
            <div style={{ marginTop: 6, fontStyle: "italic", fontSize: "10px" }}>
              “Wallet and recipient addresses are masked for display only. This is not a cryptographic privacy claim.”
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
          <button className="btn btn-sm" onClick={handleLoadDemo}>
            Load demo recipients
          </button>
          <span style={{ fontSize: "11px", color: "var(--ink-mid)" }}>
            Demo recipients — editable
          </span>
          <button className="btn btn-sm" onClick={handleClear}>
            Clear recipients
          </button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sealed Receipt panel
// ---------------------------------------------------------------------------

function SealedReceiptPanel({
  txHash,
  recipient1,
  recipient2,
}: {
  txHash: string | null;
  recipient1: string;
  recipient2: string;
}) {
  if (!txHash) {
    return (
      <section>
        <div className="section-label">08 &nbsp;Sealed Receipt</div>
        <div className="panel">
          <h2>Sealed Receipt</h2>
          <p className="info-note">
            Sealed receipt will populate after a successful disperse transaction.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="section-label">08 &nbsp;Sealed Receipt</div>
      <div className="panel">
        <h2>Sealed Receipt <span className="tag tag-live">LIVE</span></h2>
        <div className="panel-row">
          <span className="panel-key">Disperse tx</span>
          <span className="panel-value">{txHash}</span>
        </div>
        <div className="panel-row">
          <span className="panel-key">Recipient A (masked)</span>
          <span className="panel-value">{maskAddress(recipient1)}</span>
        </div>
        <div className="panel-row">
          <span className="panel-key">Recipient B (masked)</span>
          <span className="panel-value">{maskAddress(recipient2)}</span>
        </div>
        <p className="info-note" style={{ marginTop: 8, fontStyle: "italic" }}>
          “No plaintext amount is shown after sealing.”
        </p>
      </div>
    </section>
  );
}
