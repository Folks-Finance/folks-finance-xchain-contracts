import { convertEVMAddressToGenericAddress, getRandomAddress } from "../../../utils/bytes";
import { SECONDS_IN_MINUTE } from "../../../utils/time";
import { unixTime } from "../../utils/formulae";

export interface PoolData {
  lastUpdateTimestamp: bigint;
  feeData: {
    flashLoanFee: bigint;
    retentionRate: bigint;
    fTokenFeeRecipient: string;
    tokenFeeClaimer: string;
    totalRetainedAmount: bigint;
    tokenFeeRecipient: string;
  };
  depositData: {
    optimalUtilisationRatio: bigint;
    totalAmount: bigint;
    interestRate: bigint;
    interestIndex: bigint;
  };
  variableBorrowData: {
    vr0: bigint;
    vr1: bigint;
    vr2: bigint;
    totalAmount: bigint;
    interestRate: bigint;
    interestIndex: bigint;
  };
  stableBorrowData: {
    sr0: bigint;
    sr1: bigint;
    sr2: bigint;
    sr3: bigint;
    optimalStableToTotalDebtRatio: bigint;
    rebalanceUpUtilisationRatio: bigint;
    rebalanceUpDepositInterestRate: bigint;
    rebalanceDownDelta: bigint;
    totalAmount: bigint;
    interestRate: bigint;
    averageInterestRate: bigint;
  };
  capsData: {
    deposit: bigint;
    borrow: bigint;
    stableBorrowPercentage: bigint;
  };
  configData: {
    deprecated: boolean;
    stableBorrowSupported: boolean;
    canMintFToken: boolean;
    flashLoanSupported: boolean;
  };
}

export function getInitialPoolData(): PoolData {
  return {
    lastUpdateTimestamp: BigInt(unixTime() - SECONDS_IN_MINUTE),
    feeData: {
      flashLoanFee: BigInt(0.001e6),
      retentionRate: BigInt(0.1e6),
      fTokenFeeRecipient: getRandomAddress(),
      tokenFeeClaimer: getRandomAddress(),
      totalRetainedAmount: BigInt(0),
      tokenFeeRecipient: convertEVMAddressToGenericAddress(getRandomAddress()),
    },
    depositData: {
      optimalUtilisationRatio: BigInt(0.75e4),
      totalAmount: BigInt(0),
      interestRate: BigInt(0),
      interestIndex: BigInt(1.0e18),
    },
    variableBorrowData: {
      vr0: BigInt(0.0175e6),
      vr1: BigInt(0.05e6),
      vr2: BigInt(1.0e6),
      totalAmount: BigInt(0),
      interestRate: BigInt(0.0175e18),
      interestIndex: BigInt(1.0e18),
    },
    stableBorrowData: {
      sr0: BigInt(0.02e6),
      sr1: BigInt(0.02e6),
      sr2: BigInt(1.0e6),
      sr3: BigInt(0.25e6),
      optimalStableToTotalDebtRatio: BigInt(0.2e4),
      rebalanceUpUtilisationRatio: BigInt(0.95e4),
      rebalanceUpDepositInterestRate: BigInt(0.4e4),
      rebalanceDownDelta: BigInt(0.2e4),
      totalAmount: BigInt(0),
      interestRate: BigInt(0.07e18),
      averageInterestRate: BigInt(0),
    },
    capsData: {
      deposit: BigInt(100e6),
      borrow: BigInt(50e6),
      stableBorrowPercentage: BigInt(0.05e18),
    },
    configData: {
      deprecated: false,
      stableBorrowSupported: true,
      canMintFToken: true,
      flashLoanSupported: true,
    },
  };
}
