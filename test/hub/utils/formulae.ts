import {
  divScale,
  divScaleRoundUp,
  expBySquaring,
  mulScale,
  mulScaleRoundUp,
  ONE_10_DP,
  ONE_12_DP,
  ONE_14_DP,
  ONE_18_DP,
  ONE_4_DP,
  ONE_6_DP,
  SECONDS_IN_YEAR,
  sqrt,
} from "./mathLib";

function unixTime(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Calculates the dollar value of a given asset amount
 * @param amount (0dp)
 * @param price (18dp)
 * @param decimals (0dp)
 * @return value (0dp)
 */
function calcAssetDollarValue(amount: bigint, price: bigint, decimals: bigint): bigint {
  return mulScale(amount, price, BigInt(10) ** decimals);
}

/**
 * Calculates the dollar value of a given asset amount rounded up
 * @param amount (0dp)
 * @param price (18dp)
 * @param decimals (0dp)
 * @return value (0dp)
 */
function calcAssetDollarValueRoundedUp(amount: bigint, price: bigint, decimals: bigint): bigint {
  return mulScaleRoundUp(amount, price, BigInt(10) ** decimals);
}

/**
 * Calculates the asset amount from a dollar value
 * @param value (0dp)
 * @param price (18dp)
 * @param decimals (0dp)
 * @return amount (0dp)
 */
function calcAssetAmount(value: bigint, price: bigint, decimals: bigint): bigint {
  return divScale(value, price, BigInt(10) ** decimals);
}

/**
 * Converts an asset amount from one asset to another
 * @param amountFrom (0dp)
 * @param priceFrom (18dp)
 * @param decimalsFrom (0dp)
 * @param priceTo (18dp)
 * @param decimalsTo (0dp)
 * @return amountTo (0dp)
 */
function convertAssetAmount(
  amountFrom: bigint,
  priceFrom: bigint,
  decimalsFrom: bigint,
  priceTo: bigint,
  decimalsTo: bigint
): bigint {
  return mulScale(calcAssetDollarValue(amountFrom, priceFrom, decimalsFrom), BigInt(10) ** decimalsTo, priceTo);
}

/**
 * Calculates the total debt of a pool
 * @param totalVarDebt (0dp)
 * @param totalStblDebt (0dp)
 * @return totalDebt (0dp)
 */
function calcTotalDebt(totalVarDebt: bigint, totalStblDebt: bigint): bigint {
  return totalVarDebt + totalStblDebt;
}

/**
 * Calculates the total debt of a pool
 * @param totalDebt (0dp)
 * @param totalDeposits (0dp)
 * @return availableLiquidity (0dp)
 */
function calcAvailableLiquidity(totalDebt: bigint, totalDeposits: bigint): bigint {
  return totalDeposits - totalDebt;
}

/**
 * Calculates the ratio of the available liquidity that is being stable borrowed
 * @param stblBorAmount (0dp)
 * @param availableLiquidity (0dp)
 * @return stableBorrowRatio (18dp)
 */
function calcStableBorrowRatio(stblBorAmount: bigint, availableLiquidity: bigint): bigint {
  return divScale(stblBorAmount, availableLiquidity, ONE_18_DP);
}

/**
 * Calculates the maximum stable borrow amount a user can make in one go
 * @param availableLiquidity (0dp)
 * @param sbpc (0dp)
 * @return stableBorrowRatio (18dp)
 */
function calcMaxSingleStableBorrow(availableLiquidity: bigint, sbpc: bigint): bigint {
  return mulScale(availableLiquidity, sbpc, ONE_18_DP);
}

/**
 * Calculates the utilisation ratio of a pool
 * @param totalDebt (0dp)
 * @param totalDeposits (0dp)
 * @return utilisationRatio (18dp)
 */
function calcUtilisationRatio(totalDebt: bigint, totalDeposits: bigint): bigint {
  if (totalDeposits === BigInt(0)) return BigInt(0);
  return divScale(totalDebt, totalDeposits, ONE_18_DP);
}

/**
 * Calculates the stable debt to total debt ratio of a pool
 * @param totalStblDebt (0dp)
 * @param totalDebt (0dp)
 * @return stableDebtToTotalDebtRatio (18dp)
 */
function calcStableDebtToTotalDebtRatio(totalStblDebt: bigint, totalDebt: bigint): bigint {
  if (totalDebt === BigInt(0)) return BigInt(0);
  return divScale(totalStblDebt, totalDebt, ONE_18_DP);
}

/**
 * Calculate the variable borrow interest rate of a pool
 * @param vr0 (6dp)
 * @param vr1 (6dp)
 * @param vr2 (6dp)
 * @param ut (18dp)
 * @param uopt (4dp)
 * @return variableBorrowInterestRate (18dp)
 */
function calcVariableBorrowInterestRate(vr0: bigint, vr1: bigint, vr2: bigint, ut: bigint, uopt: bigint): bigint {
  return ut < from4DPto18DP(uopt)
    ? from6DPto18DP(vr0) + divScale(mulScale(ut, vr1, ONE_6_DP), uopt, ONE_4_DP)
    : from6DPto18DP(vr0 + vr1) + divScale(mulScale(ut - from4DPto18DP(uopt), vr2, ONE_6_DP), ONE_4_DP - uopt, ONE_4_DP);
}

/**
 * Calculate the stable borrow interest rate of a pool
 * @param vr1 (6dp)
 * @param sr0 (6dp)
 * @param sr1 (6dp)
 * @param sr2 (6dp)
 * @param sr3 (6dp)
 * @param ut (18dp)
 * @param uopt (4dp)
 * @param ratiot (18dp)
 * @param ratioopt (4dp)
 * @return stableBorrowInterestRate (18dp)
 */
function calcStableBorrowInterestRate(
  vr1: bigint,
  sr0: bigint,
  sr1: bigint,
  sr2: bigint,
  sr3: bigint,
  ut: bigint,
  uopt: bigint,
  ratiot: bigint,
  ratioopt: bigint
): bigint {
  const base =
    ut <= from4DPto18DP(uopt)
      ? from6DPto18DP(vr1 + sr0) + divScale(mulScale(ut, sr1, ONE_6_DP), uopt, ONE_4_DP)
      : from6DPto18DP(vr1 + sr0 + sr1) +
        divScale(mulScale(ut - from4DPto18DP(uopt), sr2, ONE_6_DP), ONE_4_DP - uopt, ONE_4_DP);
  const extra =
    ratiot <= from4DPto18DP(ratioopt)
      ? BigInt(0)
      : divScale(mulScale(sr3, ratiot - from4DPto18DP(ratioopt), ONE_6_DP), ONE_4_DP - ratioopt, ONE_4_DP);
  return base + extra;
}

/**
 * Calculate the overall borrow interest rate of a pool
 * @param totalVarDebt (0dp)
 * @param totalDebt (0dp)
 * @param vbirt (18dp)
 * @param avgsbirt (18dp)
 * @return overallBorrowInterestRate (18dp)
 */
function calcOverallBorrowInterestRate(
  totalVarDebt: bigint,
  totalStblDebt: bigint,
  vbirt: bigint,
  avgsbirt: bigint
): bigint {
  const totalDebt = calcTotalDebt(totalVarDebt, totalStblDebt);
  if (totalDebt === BigInt(0)) return BigInt(0);
  return (totalVarDebt * vbirt + totalStblDebt * avgsbirt) / totalDebt;
}

/**
 * Calculate the deposit interest rate of a pool
 * @param obirt (18dp)
 * @param ut (18dp)
 * @param rr (18dp)
 * @return overallBorrowInterestRate (18dp)
 */
function calcDepositInterestRate(obirt: bigint, rr: bigint, ut: bigint): bigint {
  return mulScale(mulScale(ut, obirt, ONE_18_DP), ONE_6_DP - rr, ONE_6_DP);
}

/**
 * Calculate the borrow interest index of pool
 * @param birt1 (18dp)
 * @param biit1 (18dp)
 * @param latestUpdate (0dp)
 * @return borrowInterestIndex (18dp)
 */
function calcBorrowInterestIndex(birt1: bigint, biit1: bigint, latestUpdate: bigint, isDelta: boolean = false): bigint {
  const dt = isDelta ? latestUpdate : BigInt(unixTime()) - latestUpdate;
  return mulScale(biit1, expBySquaring(ONE_18_DP + birt1 / SECONDS_IN_YEAR, dt, ONE_18_DP), ONE_18_DP);
}

/**
 * Calculate the deposit interest index of pool
 * @param dirt1 (18dp)
 * @param diit1 (18dp)
 * @param latestUpdate (0dp)
 * @return depositInterestIndex (18dp)
 */
function calcDepositInterestIndex(
  dirt1: bigint,
  diit1: bigint,
  latestUpdate: bigint,
  isDelta: boolean = false
): bigint {
  const dt = isDelta ? latestUpdate : BigInt(unixTime()) - latestUpdate;
  return mulScale(diit1, ONE_18_DP + mulScale(dirt1, dt, SECONDS_IN_YEAR), ONE_18_DP);
}

/**
 * Calculates the fAsset received from a deposit
 * @param depositAmount (0dp)
 * @param diit (18dp)
 * @return depositReturn (0dp)
 */
function calcDepositReturn(depositAmount: bigint, diit: bigint): bigint {
  return divScale(depositAmount, diit, ONE_18_DP);
}

/**
 * Calculates the fAsset amount from an underlying amount
 * @param amount (0dp)
 * @param diit (18dp)
 * @return fAmountReturn (0dp)
 */
function toFAmount(amount: bigint, diit: bigint): bigint {
  return divScale(amount, diit, ONE_18_DP);
}

/**
 * Calculates the asset received from a withdraw
 * @param withdrawAmount (0dp)
 * @param diit (18dp)
 * @return withdrawReturn (0dp)
 */
function calcWithdrawReturn(withdrawAmount: bigint, diit: bigint): bigint {
  return mulScale(withdrawAmount, diit, ONE_18_DP);
}

/**
 * Calculates the underlying amount from a fAsset amount
 * @param fAmount (0dp)
 * @param diit (18dp)
 * @return underlingAmountReturn (0dp)
 */
function toUnderlingAmount(fAmount: bigint, diit: bigint): bigint {
  return mulScale(fAmount, diit, ONE_18_DP);
}

/**
 * Calculates the collateral asset loan value
 * @param amount (0dp)
 * @param price (18dp)
 * @param decimals (0dp)
 * @param factor (4dp)
 * @return loanValue (8dp)
 */
function calcCollateralAssetLoanValue(amount: bigint, price: bigint, decimals: bigint, factor: bigint): bigint {
  return mulScale(calcAssetAmount(amount, price, decimals), factor, ONE_14_DP);
}

/**
 * Calculates the borrow asset loan value
 * @param amount (0dp)
 * @param price (18dp)
 * @param decimals (0dp)
 * @param factor (4dp)
 * @return loanValue (8dp)
 */
function calcBorrowAssetLoanValue(amount: bigint, price: bigint, decimals: bigint, factor: bigint): bigint {
  return mulScaleRoundUp(calcAssetAmount(amount, price, decimals), factor, ONE_14_DP);
}

/**
 * Calculates the loan's LTV ratio
 * @param totalBorrowBalanceValue (8dp)
 * @param totalCollateralBalanceValue (8dp)
 * @return LTVRatio (4dp)
 */
function calcLTVRatio(totalBorrowBalanceValue: bigint, totalCollateralBalanceValue: bigint): bigint {
  if (totalCollateralBalanceValue === BigInt(0)) return BigInt(0);
  return divScale(totalBorrowBalanceValue, totalCollateralBalanceValue, ONE_4_DP);
}

/**
 * Calculates the loan's borrow utilisation ratio
 * @param totalEffectiveBorrowBalanceValue (8dp)
 * @param totalEffectiveCollateralBalanceValue (8dp)
 * @return borrowUtilisationRatio (4dp)
 */
function calcBorrowUtilisationRatio(
  totalEffectiveBorrowBalanceValue: bigint,
  totalEffectiveCollateralBalanceValue: bigint
): bigint {
  if (totalEffectiveCollateralBalanceValue === BigInt(0)) return BigInt(0);
  return divScale(totalEffectiveBorrowBalanceValue, totalEffectiveCollateralBalanceValue, ONE_4_DP);
}

/**
 * Calculates the loan's liquidation margin
 * @param totalEffectiveBorrowBalanceValue (8dp)
 * @param totalEffectiveCollateralBalanceValue (8dp)
 * @return liquidationMargin (4dp)
 */
function calcLiquidationMargin(
  totalEffectiveBorrowBalanceValue: bigint,
  totalEffectiveCollateralBalanceValue: bigint
): bigint {
  if (totalEffectiveCollateralBalanceValue === BigInt(0)) return BigInt(0);
  return divScale(
    totalEffectiveCollateralBalanceValue - totalEffectiveBorrowBalanceValue,
    totalEffectiveCollateralBalanceValue,
    ONE_4_DP
  );
}

/**
 * Calculates the borrow balance of the loan at time t
 * @param bbtn1 (0dp)
 * @param biit (18dp)
 * @param biitn1 (18dp)
 * @return borrowBalance (0dp)
 */
function calcBorrowBalance(bbtn1: bigint, biit: bigint, biitn1: bigint): bigint {
  return mulScaleRoundUp(bbtn1, divScaleRoundUp(biit, biitn1, ONE_18_DP), ONE_18_DP);
}

/**
 * Calculates the stable borrow interest rate of the loan after a borrow increase
 * @param bbt (0dp)
 * @param amount (0dp)
 * @param sbirtn1 (18dp)
 * @param sbirt1 (18dp)
 * @return stableInterestRate (18dp)
 */
function calcStableInterestRate(bbt: bigint, amount: bigint, sbirtn1: bigint, sbirt1: bigint): bigint {
  return (bbt * sbirtn1 + amount * sbirt1) / (bbt + amount);
}

/**
 * Calculates the average stable borrow interest rate after a stable borrow increase.
 * @param borrowAmount (0dp)
 * @param borrowStableRate (18dp)
 * @param totalStableDebt (0dp)
 * @param averageBorrowStableRate (18dp)
 * @returns averageStableBorrowInterestRate (18dp)
 */
function calcIncreasingAverageStableBorrowInterestRate(
  borrowAmount: bigint,
  borrowStableRate: bigint,
  totalStableDebt: bigint,
  averageBorrowStableRate: bigint
): bigint {
  return divScale(
    mulScale(totalStableDebt, averageBorrowStableRate, ONE_18_DP) + mulScale(borrowAmount, borrowStableRate, ONE_18_DP),
    totalStableDebt + borrowAmount,
    ONE_18_DP
  );
}

/**
 * Calculates the average stable borrow interest rate after a stable borrow decrease.
 * @param borrowAmount (0dp)
 * @param borrowStableRate (18dp)
 * @param totalStableDebt (0dp)
 * @param averageBorrowStableRate (18dp)
 * @returns averageStableBorrowInterestRate (18dp)
 */
function calcDecreasingAverageStableBorrowInterestRate(
  borrowAmount: bigint,
  borrowStableRate: bigint,
  totalStableDebt: bigint,
  averageBorrowStableRate: bigint
): bigint {
  return divScale(
    mulScale(totalStableDebt, averageBorrowStableRate, ONE_18_DP) - mulScale(borrowAmount, borrowStableRate, ONE_18_DP),
    totalStableDebt - borrowAmount,
    ONE_18_DP
  );
}

/**
 * Calculates the collateral received by the protocol from liquidation.
 * @param collateralSeized (0dp)
 * @param borrowToCollateral (0dp)
 * @param liquidationFee (4dp)
 * @return reserveCol (0dp)
 */
function calcReserveCol(collateralSeized: bigint, borrowToCollateral: bigint, liquidationFee: bigint): bigint {
  const collateralSeizedAsBonus =
    collateralSeized > borrowToCollateral ? collateralSeized - borrowToCollateral : BigInt(0);
  return mulScale(collateralSeizedAsBonus, liquidationFee, ONE_4_DP);
}

/**
 * Calculates the deposit interest rate condition required to rebalance up stable borrow.
 * Note that there is also a second condition on the pool utilisation ratio.
 * @param rudir (4dp)
 * @param vr0 (6dp)
 * @param vr1 (6dp)
 * @param vr2 (6dp)
 * @return rebalanceUpThreshold (Ydp)
 */
function calcRebalanceUpThreshold(rudir: bigint, vr0: bigint, vr1: bigint, vr2: bigint): bigint {
  return mulScale(from4DPto18DP(rudir), vr0 + vr1 + vr2, ONE_6_DP);
}

/**
 * Calculates the stable interest rate condition required to rebalance down stable borrow
 * @param rdd (4dp)
 * @param sbirt1 (18dp)
 * @return rebalanceDownThreshold (4dp)
 */
function calcRebalanceDownThreshold(rdd: bigint, sbirt1: bigint): bigint {
  return mulScale(ONE_4_DP + rdd, sbirt1, ONE_4_DP);
}

/**
 * Calculates the flash loan fee amount
 * @param amount (0dp)
 * @param fee (6dp)
 * @return feeAmount (0dp)
 */
function calcFlashLoanFeeAmount(amount: bigint, fee: bigint): bigint {
  return mulScaleRoundUp(amount, fee, ONE_6_DP);
}

/**
 * Calculates the retention of the pool
 * @param actualRetained actual retained amount
 * @param totalDebt the total debt of the pool
 * @param retentionRate (Ydp) retention rate percentage
 * @param timeDelta time passed in seconds
 * @return new retained amount
 */
function calcRetention(actualRetained: bigint, totalDebt: bigint, retentionRate: bigint, timeDelta: bigint): bigint {
  return actualRetained + mulScale(mulScale(totalDebt, retentionRate, ONE_6_DP), timeDelta, SECONDS_IN_YEAR);
}

/**
 * Calculates the flash loan repayment amount for a given borrow amount and fee
 * @param borrowAmount (0dp)
 * @param fee (6dp)
 * @return repaymentAmount (0dp)
 */
function calcFlashLoanRepayment(borrowAmount: bigint, fee: bigint): bigint {
  return borrowAmount + mulScaleRoundUp(borrowAmount, fee, ONE_6_DP);
}

/**
 * Calculates the effective borrow value a loan should have to be considered healthy.
 * @param effectiveBorrowValue (8dp)
 * @param loanTargetHealth (4dp)
 * @return borrowValueTarget (8dp)
 */
function calcBorrowValueTarget(effectiveBorrowValue: bigint, loanTargetHealth: bigint): bigint {
  return mulScale(effectiveBorrowValue, loanTargetHealth, ONE_4_DP);
}

/**
 * Calculates, from the borrow amount, the collateral amount considering the liquidation bonus.
 * @param borrowAmount (0dp)
 * @param collPrice (18dp)
 * @param collDecimals (0dp)
 * @param borrPrice (18dp)
 * @param borrDecimals (0dp)
 * @param liquidationBonus (4dp)
 * @return seizedCollateralAmount (0dp)
 */
function convToSeizedCollateralAmount(
  borrowAmount: bigint,
  collPrice: bigint,
  collDecimals: bigint,
  borrPrice: bigint,
  borrDecimals: bigint,
  liquidationBonus: bigint
): bigint {
  return mulScale(
    convertAssetAmount(borrowAmount, borrPrice, borrDecimals, collPrice, collDecimals),
    ONE_4_DP + liquidationBonus,
    ONE_4_DP
  );
}

/**
 *  Calculates, from the borrow amount, the collateral f amount.
 * @param borrowAmount (0dp)
 * @param collPrice (18dp)
 * @param collDecimals (0dp)
 * @param borrPrice (18dp)
 * @param borrDecimals (0dp)
 * @param collDepositInterestIndex (18dp)
 * @return seizedCollateralAmount (0dp)
 */
function convToCollateralFAmount(
  borrowAmount: bigint,
  collPrice: bigint,
  collDecimals: bigint,
  borrPrice: bigint,
  borrDecimals: bigint,
  collDepositInterestIndex: bigint
): bigint {
  return toFAmount(
    convertAssetAmount(borrowAmount, borrPrice, borrDecimals, collPrice, collDecimals),
    collDepositInterestIndex
  );
}
/**
 * Calculates, from the collateral amount with the liquidation bonus, the repay borrow amount.
 * @param collAmount (0dp)
 * @param collPrice (18dp)
 * @param collDecimals (0dp)
 * @param borrPrice (18dp)
 * @param borrDecimals (0dp)
 * @param liquidationBonus (4dp)
 * @return repayBorrowAmount (0dp)
 */
function convToRepayBorrowAmount(
  collAmount: bigint,
  collPrice: bigint,
  collDecimals: bigint,
  borrPrice: bigint,
  borrDecimals: bigint,
  liquidationBonus: bigint
): bigint {
  return mulScale(
    convertAssetAmount(collAmount, collPrice, collDecimals, borrPrice, borrDecimals),
    ONE_4_DP + liquidationBonus,
    ONE_4_DP
  );
}

/**
 * Calculates the average stable rate between two loans.
 * @param borrowAmount (0dp)
 * @param borrowStableRate (18dp)
 * @param totalStableDebt (0dp)
 * @param averageBorrowStableRate (18dp)
 * @returns averageStableBorrowInterestRate (18dp)
 */
function calcAverageStableRate(
  liquidatorAmount: bigint,
  liquidatorStableRate: bigint,
  violatorAmount: bigint,
  violatorStableRate: bigint
): bigint {
  return divScale(
    mulScale(liquidatorAmount, liquidatorStableRate, ONE_18_DP) +
      mulScale(violatorAmount, violatorStableRate, ONE_18_DP),
    liquidatorAmount + violatorAmount,
    ONE_18_DP
  );
}

/**
 * Calculates the reward index increment.
 * @param lastUpdateTimestamp (0dp)
 * @param rewardSpeed (18dp)
 * @param totalAmount (0dp)
 * @return rewardIndexIncrement (18dp)
 */
function calcRewardIndexIncrement(lastUpdateTimestamp: bigint, rewardSpeed: bigint, totalAmount: bigint): bigint {
  return mulScale(BigInt(unixTime()) - lastUpdateTimestamp, rewardSpeed, totalAmount);
}

/**
 * Calculates the accrued rewards.
 * @param amount (0dp)
 * @param rewardIndexAtT (18dp)
 * @param rewardIndexAtT_1 (18dp)
 * @return accruedRewards (0dp)
 */
function calcAccruedRewards(amount: bigint, rewardIndexAtT: bigint, rewardIndexAtT_1: bigint): bigint {
  return mulScale(amount, rewardIndexAtT - rewardIndexAtT_1, ONE_18_DP);
}

/**
 * Calculates the LP price
 * @param r0 pool supply of asset 0
 * @param r1 pool supply of asset 1
 * @param p0 price of asset 0
 * @param p1 price of asset 1
 * @param lts circulating supply of liquidity token
 * @return bigint LP price
 */
function calcLPPrice(r0: bigint, r1: bigint, p0: bigint, p1: bigint, lts: bigint): bigint {
  return BigInt(2) * (sqrt(r0 * p0 * r1 * p1) / lts);
}

function from4DPto18DP(value: bigint): bigint {
  return value * ONE_14_DP;
}

function from6DPto18DP(value: bigint): bigint {
  return value * ONE_12_DP;
}

export {
  unixTime,
  calcAssetDollarValue,
  calcAssetDollarValueRoundedUp,
  calcAssetAmount,
  convertAssetAmount,
  calcTotalDebt,
  calcAvailableLiquidity,
  calcStableBorrowRatio,
  calcMaxSingleStableBorrow,
  calcUtilisationRatio,
  calcStableDebtToTotalDebtRatio,
  calcVariableBorrowInterestRate,
  calcStableBorrowInterestRate,
  calcOverallBorrowInterestRate,
  calcDepositInterestRate,
  calcBorrowInterestIndex,
  calcDepositInterestIndex,
  calcDepositReturn,
  toFAmount,
  calcWithdrawReturn,
  toUnderlingAmount,
  calcCollateralAssetLoanValue,
  calcBorrowAssetLoanValue,
  calcLTVRatio,
  calcBorrowUtilisationRatio,
  calcLiquidationMargin,
  calcBorrowBalance,
  calcStableInterestRate,
  calcRebalanceUpThreshold,
  calcRebalanceDownThreshold,
  calcFlashLoanRepayment,
  calcLPPrice,
  calcRetention,
  calcFlashLoanFeeAmount,
  calcIncreasingAverageStableBorrowInterestRate,
  calcDecreasingAverageStableBorrowInterestRate,
  calcReserveCol,
  calcBorrowValueTarget,
  convToSeizedCollateralAmount,
  convToCollateralFAmount,
  convToRepayBorrowAmount,
  calcAverageStableRate,
  calcRewardIndexIncrement,
  calcAccruedRewards,
  from4DPto18DP,
  from6DPto18DP,
};
