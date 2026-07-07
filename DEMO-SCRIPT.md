# 60–90s Demo Script

0–5s: “PrivateDrop is built on TokenOps Confidential Disperse. You are looking at a live Sepolia payout — and you cannot tell what anyone was paid.”

5–15s: Point to the seismograph trace above the fold. “This trace is not decorative — hover any point and you see the exact byte of the disperse transaction that generated it. 32 bytes, 32 points, all real.”

15–30s: Scroll to Sealed Receipt. “We have two recipients. Each gets a requested handle and a transferred handle — these are encrypted payout values from the TokenOps SDK. No plaintext. No amount field. The mini-traces are derived from those exact handle bytes.”

30–45s: Point to the Readiness Gate. “isRegistered, mintConfidential, setOperator, preflightDisperse — all confirmed LIVE on Sepolia before the disperse fired.”

45–60s: Scroll to Boundary. “Here is what we are not claiming. recipientDecrypt is not implemented in this build. The sender-authorized reveal path is local-verified, not live-tested. We also do not claim addresses are cryptographically private — masking is a UI choice.”

60–75s: Click “Copy proof JSON”. “Every tx hash, every handle, every label — honest, exportable, submittable.”

75–90s: “The amount stayed sealed. The proof did not.”
