export interface UserLoanCollateral {
  balance: bigint; // denominated in f token
  rewardIndex: bigint;
}

export interface UserLoanBorrow {
  amount: bigint; // excluding interest
  balance: bigint; // including interest
  lastInterestIndex: bigint;
  stableInterestRate: bigint; // defined if stable borrow
  lastStableUpdateTimestamp: bigint; // defined if stable borrow
  rewardIndex: bigint;
}

export interface UserPoolRewards {
  collateral: bigint;
  borrow: bigint;
  interestPaid: bigint;
}
