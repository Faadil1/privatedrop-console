import { createConfig } from "@zama-fhe/sdk/viem";
import { web } from "@zama-fhe/sdk/web";
import { sepolia as zamaSepoliaChain } from "@zama-fhe/sdk/chains";
import { hexToBytes } from "viem";
import type { UsePublicClientReturnType, UseWalletClientReturnType } from "wagmi";
import type { ZamaSDK } from "@zama-fhe/sdk";
import type { Encryptor } from "@tokenops/sdk/fhe-disperse";

/**
 * Build a real ZamaConfig bound to the connected wallet's viem clients.
 * Only called once a wallet is connected and the chain is confirmed to be
 * Sepolia — see App.tsx gating. Uses the browser relayer (`web()`), which
 * routes to Zama's public Sepolia relayer via a Web Worker, per
 * @tokenops/sdk's own `createSepoliaEncryptorWeb` doc comment
 * (relayer.testnet.zama.org/v2 baked into @zama-fhe/sdk's chain config).
 *
 * Parameter types are wagmi's own client return types (not raw viem types)
 * so this composes directly with usePublicClient()/useWalletClient() without
 * a generic-parameter mismatch between wagmi's Config-bound clients and
 * viem's bare PublicClient/WalletClient.
 */
export function buildZamaConfig(
  publicClient: NonNullable<UsePublicClientReturnType>,
  walletClient: NonNullable<UseWalletClientReturnType["data"]>,
) {
  return createConfig({
    chains: [zamaSepoliaChain],
    relayers: { [zamaSepoliaChain.id]: web() },
    publicClient,
    walletClient,
  });
}

/**
 * DISCOVERED MISMATCH (recorded verbatim in SPIKE-RESULT.md Section 10):
 *
 * `@tokenops/sdk@1.1.1`'s `useDisperse`/`useZamaSDK` doc comment says to wire
 * `encryptor: () => zamaSDK.relayer` directly. At the installed versions
 * (`@zama-fhe/sdk@3.2.0`, `@zama-fhe/react-sdk@3.2.0`), `zamaSDK.relayer` is a
 * `RelayerDispatcher` whose `encrypt()` resolves `{ encryptedValues: Hex[];
 * inputProof: Hex }` (hex strings) — but `@tokenops/sdk`'s `Encryptor`
 * interface requires `{ handles: Uint8Array[]; inputProof: Uint8Array }`.
 * The two are NOT structurally assignable; passing `zamaSDK.relayer` directly
 * fails `tsc`.
 *
 * This adapter performs a well-defined, standard hex->bytes conversion
 * (`viem.hexToBytes`, the same encoding both packages already agree the
 * values are — the packages just changed on wire vs. byte-array
 * representation between the version the docs were written against and the
 * installed 3.2.0). It is NOT inventing new SDK behavior — it's bridging a
 * confirmed encoding-shape drift between two real, installed packages.
 *
 * IMPORTANT: this adapter has been type-checked but never executed against a
 * live relayer call in this sandbox (no RPC/relayer egress available — see
 * SPIKE-RESULT.md Section 7/9). Treat its runtime correctness as UNVERIFIED
 * until Faadil actually clicks "Execute disperse()" against live Sepolia and
 * either gets a real tx hash or a concrete error to report back.
 */
export function adaptZamaEncryptor(zamaSDK: ZamaSDK): Encryptor {
  return {
    async encrypt(params) {
      // DISCOVERED MISMATCH #2: @tokenops/sdk's FheValueInput type includes
      // "euint160", "ebytes64", "ebytes128", "ebytes256" — but the installed
      // @zama-fhe/sdk@3.2.0 EncryptInput type does not have those variants at
      // all. Confidential Disperse only ever encrypts "euint64" amounts, so
      // this guard is a real, honest runtime check (not a silent cast) that
      // fails loudly and specifically if that assumption is ever violated.
      const SUPPORTED_TYPES = new Set([
        "ebool",
        "eaddress",
        "euint8",
        "euint16",
        "euint32",
        "euint64",
        "euint128",
        "euint256",
      ]);
      for (const v of params.values) {
        if (!SUPPORTED_TYPES.has(v.type)) {
          throw new Error(
            `adaptZamaEncryptor: value type "${v.type}" is not supported by the ` +
              `installed @zama-fhe/sdk@3.2.0 EncryptInput type (euint160/ebytes64/` +
              `ebytes128/ebytes256 are absent in this version). Real, discovered ` +
              `version-mismatch — see SPIKE-RESULT.md Section 10.`,
          );
        }
      }
      const result = await zamaSDK.relayer.encrypt({
        values: params.values as Parameters<typeof zamaSDK.relayer.encrypt>[0]["values"],
        contractAddress: params.contractAddress,
        userAddress: params.userAddress,
      });
      return {
        handles: result.encryptedValues.map((v) => hexToBytes(v)),
        inputProof: hexToBytes(result.inputProof),
      };
    },
  };
}
