import type { Account, Address, Hex } from "viem";
import type { UsePublicClientReturnType, UseWalletClientReturnType } from "wagmi";

/**
 * DISCOVERED BLOCKER (see SPIKE-RESULT.md Section 12):
 *
 * `@tokenops/sdk/fhe`'s `setOperator()` is the correct, documented,
 * confirmed API for this approval step (verified from
 * `node_modules/@tokenops/sdk/dist/fhe/operators.d.ts` and its compiled
 * source `chunk-WRCUDSUJ.js`). But importing anything from `@tokenops/sdk/fhe`
 * pulls in that subpath's barrel (`dist/fhe/index.js`), which has a top-level
 * `import { RelayerWeb, MainnetConfig, SepoliaConfig } from '@zama-fhe/sdk'`.
 *
 * `SepoliaConfig`/`MainnetConfig` existed in `@zama-fhe/sdk@3.0.0` (confirmed
 * via `npm pack @zama-fhe/sdk@3.0.0` and inspecting its `.d.ts`) but were
 * removed by `3.2.0` (the version installed here, inside @tokenops/sdk's own
 * declared `^3.0.0` peer range) — a semver-breaking removal on Zama's side.
 * Rolldown/vite fails to statically resolve those names and the production
 * build fails ("Missing export").
 *
 * Rather than downgrading @zama-fhe/sdk (risking new incompatibilities with
 * ZamaProvider/useZamaSDK, already wired against 3.2.0's shapes) or guessing
 * an alternate approval call, this file is a **verbatim copy** of the ABI
 * fragment, deadline constant, and writeContract/waitForTransactionReceipt
 * call sequence from `@tokenops/sdk/fhe/operators.ts`'s compiled output —
 * copied, not reconstructed from assumption — so the exact, confirmed
 * on-chain call happens without importing the broken barrel.
 *
 * If @tokenops/sdk ships a fix (e.g. splitting `./fhe/operators` into its
 * own exports-map entry, or re-publishing against a `@zama-fhe/sdk` version
 * that still has `SepoliaConfig`/`MainnetConfig`), this file should be
 * deleted and `setOperator` imported from `@tokenops/sdk/fhe` directly again.
 */

const ERC7984_SET_OPERATOR_ABI = [
  {
    type: "function",
    name: "setOperator",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "until", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

/** `2**48 - 1` — verbatim from @tokenops/sdk's ERC7984_OPERATOR_MAX_DEADLINE. */
export const ERC7984_OPERATOR_MAX_DEADLINE = (1n << 48n) - 1n;

export interface LocalSetOperatorArgs {
  publicClient: NonNullable<UsePublicClientReturnType>;
  walletClient: NonNullable<UseWalletClientReturnType["data"]>;
  account?: Account | Address;
  token: Address;
  spender: Address;
  deadline?: bigint;
  waitForReceipt?: boolean;
}

/**
 * Verbatim-ported `setOperator()` — calls the real ERC-7984
 * `setOperator(address operator, uint48 until)` selector on `token`,
 * authorizing `spender` (the TokenOps Disperse singleton) to act as
 * operator. Mirrors @tokenops/sdk's account-resolution, deadline defaulting,
 * and error semantics exactly; only the module boundary differs.
 */
export async function setOperatorDirect(args: LocalSetOperatorArgs): Promise<Hex> {
  const { publicClient, walletClient, account, waitForReceipt = true } = args;
  const token = args.token;
  const spender = args.spender;
  const deadline = args.deadline ?? ERC7984_OPERATOR_MAX_DEADLINE;

  const fromAccount = account ?? walletClient.account;
  if (!fromAccount) {
    throw new Error(
      "setOperatorDirect: no account available — pass `account` explicitly or attach an account to the walletClient",
    );
  }
  if (deadline < 0n || deadline > ERC7984_OPERATOR_MAX_DEADLINE) {
    throw new Error(
      `setOperatorDirect: deadline ${deadline} out of uint48 range [0, ${ERC7984_OPERATOR_MAX_DEADLINE}]`,
    );
  }
  const deadlineNum = Number(deadline);

  let hash: Hex;
  try {
    hash = await walletClient.writeContract({
      address: token,
      abi: ERC7984_SET_OPERATOR_ABI,
      functionName: "setOperator",
      args: [spender, deadlineNum],
      account: fromAccount,
      chain: walletClient.chain,
    });
  } catch (err) {
    throw new Error(
      `setOperatorDirect: writeContract failed (token=${token}, spender=${spender}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (waitForReceipt) {
    try {
      await publicClient.waitForTransactionReceipt({ hash });
    } catch (err) {
      throw new Error(
        `setOperatorDirect: receipt wait failed (tx=${hash}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return hash;
}
