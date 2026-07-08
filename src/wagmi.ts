import { http, createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// Sepolia-only by design for this spike. PrivateDrop Console targets
// TokenOps' deployed Confidential Disperse singleton, which only exists
// on chain 1 (mainnet) and 11155111 (Sepolia) per
// @tokenops/sdk core/addresses.ts. Mainnet is intentionally excluded here.
export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(),
  },
});

export const SEPOLIA_CHAIN_ID = sepolia.id; // 11155111
