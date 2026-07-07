# PrivateDrop Console — Built on TokenOps Confidential Disperse

Distribute tokens. Prove it happened. Hide what was paid.

PrivateDrop is a judge-facing proof instrument for TokenOps Confidential Disperse. A live Sepolia disperse produced encrypted requested/transferred handles for two recipients. After sealing, plaintext payout amounts never reappear in the UI.

The interface turns the live disperse transaction and encrypted handle bytes into deterministic proof traces, so judges can see the proof object without seeing the amounts.

LIVE: isRegistered · mintConfidential · setOperator · preflightDisperse ready=true · disperse tx 0xb487…86f50 · encrypted handles

LOCAL_VERIFIED: deterministic trace generation · sender-authorized recipient reveal path

LIMITATION: recipient reveal was not live-tested in this submission · recipient addresses are masked in UI only, not cryptographically private · Sepolia testnet · CTTT test token
