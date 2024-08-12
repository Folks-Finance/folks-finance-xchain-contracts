// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";

library MathUtils {
    using Math for uint256;

    uint256 private constant SECONDS_IN_YEAR = 365 days;
    uint256 internal constant ONE_4_DP = 1e4;
    uint256 internal constant ONE_6_DP = 1e6;
    uint256 internal constant ONE_10_DP = 1e10;
    uint256 internal constant ONE_12_DP = 1e12;
    uint256 internal constant ONE_14_DP = 1e14;
    uint256 internal constant ONE_18_DP = 1e18;

    /// @dev Calculates the dollar value of an asset.
    /// @param amount The amount of the asset.
    /// @param price 18dp - The price of the asset in USD.
    /// @param decimals The decimals of the asset.
    /// @return 18dp - The asset price.
    function calcAssetDollarValue(uint256 amount, uint256 price, uint8 decimals) internal pure returns (uint256) {
        return amount.mulDiv(price, 10 ** decimals);
    }

    /// @dev Calculates the dollar value of an asset rounded up.
    /// @param amount The amount of the asset.
    /// @param price 18dp - The price of the asset in USD.
    /// @param decimals The decimals of the asset.
    /// @return 18dp - The dollar value of the asset, rounded up.
    function calcAssetDollarValueRoundedUp(
        uint256 amount,
        uint256 price,
        uint8 decimals
    ) internal pure returns (uint256) {
        return amount.mulDiv(price, 10 ** decimals, Math.Rounding.Ceil);
    }

    /// @dev Calculates the asset amount given the dollar value.
    /// @param amountValue The dollar value of the asset.
    /// @param price 18dp - The price of the asset in USD.
    /// @param decimals The decimals of the asset.
    /// @return The asset amount.
    function calcAssetAmount(uint256 amountValue, uint256 price, uint8 decimals) internal pure returns (uint256) {
        return amountValue.mulDiv(10 ** decimals, price);
    }

    /// @dev Converts the amount of asset to the equivalent amount of another asset.
    /// @param amountFrom The amount of asset from which to convert.
    /// @param priceFrom 18dp - The price of asset from which to convert in USD.
    /// @param decimalsFrom The decimals of asset from which to convert.
    /// @param priceTo 18dp - The price of asset to which to convert in USD.
    /// @param decimalsTo The decimals of asset to which to convert.
    /// @return The equivalent amount of asset.
    function convertAssetAmount(
        uint256 amountFrom,
        uint256 priceFrom,
        uint8 decimalsFrom,
        uint256 priceTo,
        uint8 decimalsTo
    ) internal pure returns (uint256) {
        return calcAssetDollarValue(amountFrom, priceFrom, decimalsFrom).mulDiv(10 ** decimalsTo, priceTo);
    }

    /// @dev Calculates the available liquidity by subtracting total debt from total deposits.
    /// @param totalDebt The total debt.
    /// @param totalDeposits The total deposits.
    /// @return The available liquidity.
    function calcAvailableLiquidity(uint256 totalDebt, uint256 totalDeposits) internal pure returns (uint256) {
        return totalDeposits - totalDebt;
    }

    /// @dev Calculates the stable borrow ratio by dividing the stable borrow amount by the available liquidity.
    /// @param stblBorrowAmount The stable borrow amount.
    /// @param availableLiquidity The available liquidity.
    /// @return 18dp - The stable borrow ratio.
    function calcStableBorrowRatio(
        uint256 stblBorrowAmount,
        uint256 availableLiquidity
    ) internal pure returns (uint256) {
        return stblBorrowAmount.mulDiv(ONE_18_DP, availableLiquidity);
    }

    /// @dev Calculates the utilisation ratio by dividing the total debt by the total deposits.
    /// @param totalDebt The total debt.
    /// @param totalDeposits The total deposits.
    /// @return 18dp - The utilisation ratio or 0 if total deposits is 0.
    function calcUtilisationRatio(uint256 totalDebt, uint256 totalDeposits) internal pure returns (uint256) {
        return totalDeposits > 0 ? totalDebt.mulDiv(ONE_18_DP, totalDeposits) : 0;
    }

    /// @dev Calculates the ratio of stable debt to total debt.
    /// @param totalStblDebt The total stable debt.
    /// @param totalDebt The total debt.
    /// @return 18dp - The ratio of stable debt to total debt or 0 if total debt is 0.
    function calcStableDebtToTotalDebtRatio(uint256 totalStblDebt, uint256 totalDebt) internal pure returns (uint256) {
        return totalDebt > 0 ? totalStblDebt.mulDiv(ONE_18_DP, totalDebt) : 0;
    }

    /// @dev Calculates the variable borrow interest rate based on the utilisation ratio and optimal utilisation ratio.
    /// @param vr0 6dp - The initial variable borrow interest rate.
    /// @param vr1 6dp - The variable borrow interest rate till optimal utilisation ratio.
    /// @param vr2 6dp - The variable borrow interest rate after optimal utilisation ratio.
    /// @param utilisationRatioAtT 18dp - The utilisation ratio at time T.
    /// @param optimalUtilisationRatio 4dp - The optimal utilisation ratio.
    /// @return 18dp - The calculated variable borrow interest rate at time T.
    function calcVariableBorrowInterestRate(
        uint32 vr0,
        uint32 vr1,
        uint32 vr2,
        uint256 utilisationRatioAtT,
        uint16 optimalUtilisationRatio
    ) internal pure returns (uint256) {
        return
            utilisationRatioAtT < from4DPto18DP(optimalUtilisationRatio)
                ? from6DPto18DP(vr0) +
                    utilisationRatioAtT.mulDiv(vr1, ONE_6_DP).mulDiv(ONE_4_DP, optimalUtilisationRatio)
                : from6DPto18DP(vr0 + vr1) +
                    (utilisationRatioAtT - from4DPto18DP(optimalUtilisationRatio)).mulDiv(vr2, ONE_6_DP).mulDiv(
                        ONE_4_DP,
                        ONE_4_DP - optimalUtilisationRatio
                    );
    }

    /// @dev Calculates the stable borrow interest rate of a pool.
    /// @param vr1 6dp - The variable rate when utilisation ratio is less than optimal utilisation ratio.
    /// @param sr0 6dp - The initial stable rate.
    /// @param sr1 6dp - The stable rate when utilisation ratio is less than optimal.
    /// @param sr2 6dp - The stable rate when utilisation ratio is more than optimal.
    /// @param sr3 6dp - The stable rate when stable debt to total debt ratio is more than optimal.
    /// @param utilisationRatioAtT 18dp - The utilisation ratio at time T.
    /// @param optimalUtilisationRatio 4dp - The optimal utilisation ratio.
    /// @param stableDebtToTotalDebtRatioAtT 18dp - The ratio of stable debt to total debt at time T.
    /// @param optimalStableToTotalDebtRatio 4dp - The optimal ratio of stable debt to total debt.
    /// @return 18dp - The calculated stable borrow interest rate.
    function calcStableBorrowInterestRate(
        uint32 vr1,
        uint32 sr0,
        uint32 sr1,
        uint32 sr2,
        uint32 sr3,
        uint256 utilisationRatioAtT,
        uint16 optimalUtilisationRatio,
        uint256 stableDebtToTotalDebtRatioAtT,
        uint16 optimalStableToTotalDebtRatio
    ) internal pure returns (uint256) {
        return
            (
                utilisationRatioAtT <= from4DPto18DP(optimalUtilisationRatio)
                    ? from6DPto18DP(vr1 + sr0) +
                        utilisationRatioAtT.mulDiv(sr1, ONE_6_DP).mulDiv(ONE_4_DP, optimalUtilisationRatio)
                    : from6DPto18DP(vr1 + sr0 + sr1) +
                        (utilisationRatioAtT - from4DPto18DP(optimalUtilisationRatio)).mulDiv(sr2, ONE_6_DP).mulDiv(
                            ONE_4_DP,
                            ONE_4_DP - optimalUtilisationRatio
                        )
            ) +
            (
                stableDebtToTotalDebtRatioAtT <= from4DPto18DP(optimalStableToTotalDebtRatio)
                    ? 0
                    : (stableDebtToTotalDebtRatioAtT - from4DPto18DP(optimalStableToTotalDebtRatio))
                        .mulDiv(sr3, ONE_6_DP)
                        .mulDiv(ONE_4_DP, ONE_4_DP - optimalStableToTotalDebtRatio)
            );
    }

    /// @dev Calculates the overall borrow interest rate of a pool
    /// @param totalVarDebt The total variable borrows across all loans for the given pool.
    /// @param totalStblDebt The total stable borrows across all loans for the given pool.
    /// @param variableBorrowInterestRateAtT 18dp - The variable borrow interest rate of dispenser at time t.
    /// @param avgStableBorrowInterestRateAtT 18dp - The average stable borrow interest rate at time t.
    /// @return 18dp - The calculated overall borrow interest rate at time t, or 0 if total debt is 0.
    function calcOverallBorrowInterestRate(
        uint256 totalVarDebt,
        uint256 totalStblDebt,
        uint256 variableBorrowInterestRateAtT,
        uint256 avgStableBorrowInterestRateAtT
    ) internal pure returns (uint256) {
        uint256 totalDebt = totalVarDebt + totalStblDebt;
        return
            totalDebt > 0
                ? (totalVarDebt.mulDiv(variableBorrowInterestRateAtT, ONE_18_DP) +
                    totalStblDebt.mulDiv(avgStableBorrowInterestRateAtT, ONE_18_DP)).mulDiv(ONE_18_DP, totalDebt)
                : 0;
    }

    /// @dev Calculates the deposit interest rate of a pool.
    /// @param utilisationRatioAtT 18dp - The utilisation ratio at time T.
    /// @param overallBorrowInterestRateAtT 18dp - The overall borrow interest rate at time T.
    /// @param retentionRate 6dp - The retention rate.
    /// @return 18dp - The calculated deposit interest rate at time T.
    function calcDepositInterestRate(
        uint256 utilisationRatioAtT,
        uint256 overallBorrowInterestRateAtT,
        uint32 retentionRate
    ) internal pure returns (uint256) {
        return
            utilisationRatioAtT.mulDiv(overallBorrowInterestRateAtT, ONE_18_DP).mulDiv(
                ONE_6_DP - retentionRate,
                ONE_6_DP
            );
    }

    function exponentialBySquaring(uint256 x, uint256 n, uint256 scale) internal pure returns (uint256 z) {
        z = n % 2 != 0 ? x : scale;
        for (n /= 2; n != 0; n /= 2) {
            x = x.mulDiv(x, scale);
            if (n % 2 != 0) {
                z = z.mulDiv(x, scale);
            }
        }
    }

    /// @dev Calculates the borrow interest index of a pool as compound interest.
    /// @param borrowInterestRateAtT_1 18dp - The borrow interest rate of a pool at time T-1.
    /// @param borrowInterestIndexAtT_1 18dp - The borrow interest index of a pool at time T-1.
    /// @param timeDelta The time in seconds from the latest update.
    /// @return 18dp - The calculated borrow interest index at time T.
    function calcBorrowInterestIndex(
        uint256 borrowInterestRateAtT_1,
        uint256 borrowInterestIndexAtT_1,
        uint256 timeDelta
    ) internal pure returns (uint256) {
        return
            borrowInterestIndexAtT_1.mulDiv(
                exponentialBySquaring(ONE_18_DP + (borrowInterestRateAtT_1 / SECONDS_IN_YEAR), timeDelta, ONE_18_DP),
                ONE_18_DP
            );
    }

    /// @dev Calculates the deposit interest index of a pool as linear interest.
    /// @param depositInterestRateAtT_1 18dp - The deposit interest rate of a pool at time T-1.
    /// @param depositInterestIndexAtT_1 18dp - The deposit interest index of a pool at time T-1.
    /// @param timeDelta The time in seconds from the latest update.
    /// @return 18dp - The calculated deposit interest index at time T.
    function calcDepositInterestIndex(
        uint256 depositInterestRateAtT_1,
        uint256 depositInterestIndexAtT_1,
        uint256 timeDelta
    ) internal pure returns (uint256) {
        return
            depositInterestIndexAtT_1.mulDiv(
                ONE_18_DP + depositInterestRateAtT_1.mulDiv(timeDelta, SECONDS_IN_YEAR),
                ONE_18_DP
            );
    }

    /// @dev Calculates fAsset received from depositing.
    /// @param underlyingAmount The amount of the underlying asset.
    /// @param depositInterestIndexAtT 18dp - The deposit interest index at time T.
    /// @param rounding Whether to round returned amount up or down
    /// @return The corresponding fAsset amount.
    function toFAmount(
        uint256 underlyingAmount,
        uint256 depositInterestIndexAtT,
        Math.Rounding rounding
    ) internal pure returns (uint256) {
        return underlyingAmount.mulDiv(ONE_18_DP, depositInterestIndexAtT, rounding);
    }

    /// @dev Calculates the asset amount received from withdrawing.
    /// @param fAmount The amount of fAsset.
    /// @param depositInterestIndexAtT 18dp - The deposit interest index at time T.
    /// @return The corresponding underling asset amount.
    function toUnderlingAmount(uint256 fAmount, uint256 depositInterestIndexAtT) internal pure returns (uint256) {
        return fAmount.mulDiv(depositInterestIndexAtT, ONE_18_DP);
    }

    /// @dev Calculates the collateral asset loan value.
    /// @param amount The amount of collateral asset.
    /// @param price 18dp - The price of the collateral asset.
    /// @param decimals The decimals of the collateral asset.
    /// @param collateralFactor 4dp - The collateral factor.
    /// @return 8dp - The collateral asset loan value.
    function calcCollateralAssetLoanValue(
        uint256 amount,
        uint256 price,
        uint8 decimals,
        uint256 collateralFactor
    ) internal pure returns (uint256) {
        return calcAssetDollarValue(amount, price, decimals).mulDiv(collateralFactor, ONE_14_DP);
    }

    /// @dev Calculates the borrow asset loan value.
    /// @param amount The amount of borrow asset.
    /// @param price 18dp - The price of the borrow asset.
    /// @param borrowFactor 4dp - The borrow factor.
    /// @return 8dp - The borrow asset loan value.
    function calcBorrowAssetLoanValue(
        uint256 amount,
        uint256 price,
        uint8 decimals,
        uint256 borrowFactor
    ) internal pure returns (uint256) {
        return calcAssetDollarValue(amount, price, decimals).mulDiv(borrowFactor, ONE_14_DP, Math.Rounding.Ceil);
    }

    /// @dev Calculates the borrow balance of a loan at time T.
    /// @param borrowBalanceAtTn_1 The borrow balance of a loan at time Tn-1.
    /// @param borrowInterestIndexAtT 18dp - The borrow interest index of a pool at time T-1.
    /// @param borrowInterestIndexAtTn_1 18dp - The borrow interest index of a pool at time Tn-1.
    /// @return The borrow balance of a loan at time T.
    function calcBorrowBalance(
        uint256 borrowBalanceAtTn_1,
        uint256 borrowInterestIndexAtT,
        uint256 borrowInterestIndexAtTn_1
    ) internal pure returns (uint256) {
        return
            borrowBalanceAtTn_1.mulDiv(
                borrowInterestIndexAtT.mulDiv(ONE_18_DP, borrowInterestIndexAtTn_1, Math.Rounding.Ceil),
                ONE_18_DP,
                Math.Rounding.Ceil
            );
    }

    /// @dev Calculates the stable borrow interest rate of a loan after a borrow increase.
    /// @param borrowBalanceAtT The borrow balance of a loan at time T (excluding the borrow amount increase).
    /// @param amount The amount of borrow increase.
    /// @param stableBorrowInterestRateAtTN_1 18dp - The stable borrow interest rate of a loan at time Tn-1.
    /// @param stableBorrowInterestRateAtT_1 18dp - The stable borrow interest rate of a pool at time T-1 i.e. before the borrow increase.
    /// @return 18dp - The new stable borrow interest rate.
    function calcStableInterestRate(
        uint256 borrowBalanceAtT,
        uint256 amount,
        uint256 stableBorrowInterestRateAtTN_1,
        uint256 stableBorrowInterestRateAtT_1
    ) internal pure returns (uint256) {
        return
            (borrowBalanceAtT * stableBorrowInterestRateAtTN_1 + amount * stableBorrowInterestRateAtT_1) /
            (borrowBalanceAtT + amount);
    }

    /// @dev Calculates the average stable borrow interest rate after a stable borrow increase.
    /// @param borrowAmount The amount of borrow increase.
    /// @param borrowStableRate 18dp - The stable borrow interest rate of the borrow increase.
    /// @param totalStableDebt The total stable debt of the pool.
    /// @param averageBorrowStableRate 18dp - The average stable borrow interest rate of the pool.
    /// @return 18dp - The increase in the stable borrow interest rate.
    function calcIncreasingAverageStableBorrowInterestRate(
        uint256 borrowAmount,
        uint256 borrowStableRate,
        uint256 totalStableDebt,
        uint256 averageBorrowStableRate
    ) internal pure returns (uint256) {
        return
            (totalStableDebt.mulDiv(averageBorrowStableRate, ONE_18_DP, Math.Rounding.Ceil) +
                borrowAmount.mulDiv(borrowStableRate, ONE_18_DP, Math.Rounding.Ceil)).mulDiv(
                    ONE_18_DP,
                    totalStableDebt + borrowAmount
                );
    }

    /// @dev Calculates the average stable borrow interest rate after a stable borrow decrease.
    /// @param borrowAmount The amount of borrow decrease.
    /// @param borrowStableRate 18dp - The stable borrow interest rate of the borrow decrease.
    /// @param totalStableDebt The total stable debt of the pool.
    /// @param averageBorrowStableRate 18dp - The average stable borrow interest rate of the pool.
    /// @return 18dp - The decrease in the stable borrow interest rate.
    function calcDecreasingAverageStableBorrowInterestRate(
        uint256 borrowAmount,
        uint256 borrowStableRate,
        uint256 totalStableDebt,
        uint256 averageBorrowStableRate
    ) internal pure returns (uint256) {
        uint256 newTotalStableDebt = totalStableDebt - borrowAmount;
        (, uint256 overallInterestAmount) = totalStableDebt
            .mulDiv(averageBorrowStableRate, ONE_18_DP, Math.Rounding.Ceil)
            .trySub(borrowAmount.mulDiv(borrowStableRate, ONE_18_DP));
        return newTotalStableDebt > 0 ? overallInterestAmount.mulDiv(ONE_18_DP, newTotalStableDebt) : 0;
    }

    /// @dev Calculates the collateral received by the protocol from liquidation.
    /// @param seizedCollateralFAmount The amount of collateral seized from a liquidation.
    /// @param borrowToCollateralFAmount The liquidaion amount expressed in fAsset.
    /// @param liquidationFee 4dp - The liquidation fee.
    /// @return The collateral received by the protocol from liquidation.
    function calcReserveCol(
        uint256 seizedCollateralFAmount,
        uint256 borrowToCollateralFAmount,
        uint256 liquidationFee
    ) internal pure returns (uint256) {
        uint256 collateralSeizedAsBonus = seizedCollateralFAmount > borrowToCollateralFAmount
            ? seizedCollateralFAmount - borrowToCollateralFAmount
            : 0;
        return collateralSeizedAsBonus.mulDiv(liquidationFee, ONE_4_DP);
    }

    /// @dev Calculates the deposit interest rate condition required to rebalance up stable borrow.
    /// @param rebalanceUpDepositInterestRate 4dp - The deposit interest rate required to rebalance up.
    /// @param vr0 6dp - The initial variable borrow interest rate.
    /// @param vr1 6dp - The variable borrow interest rate till optimal utilisation ratio.
    /// @param vr2 6dp - The variable borrow interest rate after optimal utilisation ratio.
    /// @return 18dp - The rebalance up threshold for deposit interest rate.
    function calcRebalanceUpThreshold(
        uint16 rebalanceUpDepositInterestRate,
        uint32 vr0,
        uint32 vr1,
        uint32 vr2
    ) internal pure returns (uint256) {
        return from4DPto18DP(rebalanceUpDepositInterestRate).mulDiv(vr0 + vr1 + vr2, ONE_6_DP);
    }

    /// @dev Calculates the stable interest rate condition required to rebalance down stable borrow.
    /// @param rebalanceDownDelta 4dp - The rebalance down delta.
    /// @param stableBorrowInterestRateAtT_1 18dp - The stable borrow interest rate for loan's at time T-1.
    /// @return 18dp - The rebalance down threshold for loan's stable interest rate.
    function calcRebalanceDownThreshold(
        uint256 rebalanceDownDelta,
        uint256 stableBorrowInterestRateAtT_1
    ) internal pure returns (uint256) {
        return (ONE_4_DP + rebalanceDownDelta).mulDiv(stableBorrowInterestRateAtT_1, ONE_4_DP);
    }

    /// @dev Calculates the flash loan fee amount.
    /// @param amount The flash loan amount.
    /// @param fee 6dp - The percentage fee for the flash loan.
    /// @return The flash loan fee amount.
    function calcFlashLoanFeeAmount(uint256 amount, uint32 fee) internal pure returns (uint256) {
        return amount.mulDiv(fee, ONE_6_DP, Math.Rounding.Ceil);
    }

    /// @dev Calculates the accrued retention of a pool from the last update.
    /// @param actualRetained The actual amount retained.
    /// @param totalDebt The total amount borrowed of the pool.
    /// @param overallBorrowInterestRate 18dp - The overall borrow interest rate.
    /// @param retentionRate 6dp - The retention rate.
    /// @param timeDelta The time in seconds from the last update.
    /// @return The accrued retention amount.
    function calcRetention(
        uint256 actualRetained,
        uint256 totalDebt,
        uint256 overallBorrowInterestRate,
        uint32 retentionRate,
        uint256 timeDelta
    ) internal pure returns (uint256) {
        return
            actualRetained +
            totalDebt.mulDiv(overallBorrowInterestRate, ONE_18_DP).mulDiv(retentionRate, ONE_6_DP).mulDiv(
                timeDelta,
                SECONDS_IN_YEAR
            );
    }

    /// @dev Calculates the effective borrow value a loan should have to be considered healthy.
    /// @param effectiveBorrowValue 8dp - The effective borrow value of a loan.
    /// @param loanTargetHealth 4dp - The loan target health.
    /// @return 8dp - The effective borrow value target.
    function calcBorrowValueTarget(
        uint256 effectiveBorrowValue,
        uint32 loanTargetHealth
    ) internal pure returns (uint256) {
        return effectiveBorrowValue.mulDiv(loanTargetHealth, ONE_4_DP);
    }

    /// @dev Calculates, from the borrow amount, the collateral amount considering the liquidation bonus.
    /// @param borrowAmount The amount of borrow asset.
    /// @param collPrice 18dp - The price of the collateral asset.
    /// @param collDecimals The decimals of the collateral asset.
    /// @param borrPrice 18dp - The price of the borrow asset.
    /// @param borrDecimals The decimals of the borrow asset.
    /// @param liquidationBonus 4dp - The liquidation bonus.
    /// @return The seized collateral amount considering the liquidation bonus.
    function convToSeizedCollateralAmount(
        uint256 borrowAmount,
        uint256 collPrice,
        uint8 collDecimals,
        uint256 borrPrice,
        uint8 borrDecimals,
        uint256 liquidationBonus
    ) internal pure returns (uint256) {
        return
            Math.mulDiv(
                convertAssetAmount(borrowAmount, borrPrice, borrDecimals, collPrice, collDecimals),
                (MathUtils.ONE_4_DP + liquidationBonus),
                MathUtils.ONE_4_DP
            );
    }

    /// @dev Calculates, from the borrow amount, the collateral f amount.
    /// @param borrowAmount The amount of borrow asset.
    /// @param collPrice 18dp - The price of the collateral asset.
    /// @param collDecimals The decimals of the collateral asset.
    /// @param borrPrice 18dp - The price of the borrow asset.
    /// @param borrDecimals The decimals of the borrow asset.
    /// @param collDepositInterestIndex 18dp - The deposit interest index of the collateral asset.
    /// @return The collateral amount expressed in fAsset.
    function convToCollateralFAmount(
        uint256 borrowAmount,
        uint256 collPrice,
        uint8 collDecimals,
        uint256 borrPrice,
        uint8 borrDecimals,
        uint256 collDepositInterestIndex
    ) internal pure returns (uint256) {
        return
            toFAmount(
                convertAssetAmount(borrowAmount, borrPrice, borrDecimals, collPrice, collDecimals),
                collDepositInterestIndex,
                Math.Rounding.Floor
            );
    }

    /// @dev Calculates, from the collateral amount with the liquidation bonus, the repay borrow amount.
    /// @param collAmount The amount of collateral asset.
    /// @param collPrice 18dp - The price of the collateral asset.
    /// @param collDecimals The decimals of the collateral asset.
    /// @param borrPrice 18dp - The price of the borrow asset.
    /// @param borrDecimals The decimals of the borrow asset.
    /// @param liquidationBonus 4dp - The liquidation bonus.
    /// @return The repay borrow amount.
    function convToRepayBorrowAmount(
        uint256 collAmount,
        uint256 collPrice,
        uint8 collDecimals,
        uint256 borrPrice,
        uint8 borrDecimals,
        uint256 liquidationBonus
    ) internal pure returns (uint256) {
        return
            Math.mulDiv(
                convertAssetAmount(collAmount, collPrice, collDecimals, borrPrice, borrDecimals),
                MathUtils.ONE_4_DP,
                (MathUtils.ONE_4_DP + liquidationBonus)
            );
    }

    /// @dev Calculates the average stable rate between two loans.
    /// @param liquidatorAmount The amount of the liquidator loan.
    /// @param liquidatorStableRate 18dp - The stable rate of the liquidator loan.
    /// @param violatorAmount The amount of the violator loan.
    /// @param violatorStableRate 18dp - The stable rate of the violator loan.
    /// @return 18dp - The average stable rate.
    function calcAverageStableRate(
        uint256 liquidatorAmount,
        uint256 liquidatorStableRate,
        uint256 violatorAmount,
        uint256 violatorStableRate
    ) internal pure returns (uint256) {
        return
            (liquidatorAmount.mulDiv(liquidatorStableRate, ONE_18_DP) +
                violatorAmount.mulDiv(violatorStableRate, ONE_18_DP)).mulDiv(
                    ONE_18_DP,
                    liquidatorAmount + violatorAmount
                );
    }

    /// @dev Calculates the reward index increment.
    /// @param lastUpdateTimestamp The timestamp of the reward index last update.
    /// @param rewardSpeed 18dp - The reward speed of collateral or borrow reward i.e. the reward per second.
    /// @param totalAmount The total amount of collateral or borrow in the pool.
    /// @return 18dp - The reward index increment.
    function calcRewardIndexIncrement(
        uint256 lastUpdateTimestamp,
        uint256 rewardSpeed,
        uint256 totalAmount
    ) internal view returns (uint256) {
        return Math.mulDiv(block.timestamp - lastUpdateTimestamp, rewardSpeed, totalAmount);
    }

    /// @dev Calculates the accrued rewards.
    /// @param amount The amount of collateral or borrow of the user in the loan pool.
    /// @param rewardIndexAtT 18dp - The global collateral or borrow reward index.
    /// @param rewardIndexAtT_1 18dp - The user's collateral or borrow reward index.
    /// @return The accrued rewards.
    function calcAccruedRewards(
        uint256 amount,
        uint256 rewardIndexAtT,
        uint256 rewardIndexAtT_1
    ) internal pure returns (uint256) {
        return Math.mulDiv(amount, rewardIndexAtT - rewardIndexAtT_1, MathUtils.ONE_18_DP);
    }

    function from0DPto18DP(uint256 value) internal pure returns (uint256) {
        return value * ONE_18_DP;
    }
    function from4DPto18DP(uint256 value) internal pure returns (uint256) {
        return value * ONE_14_DP;
    }
    function from6DPto18DP(uint256 value) internal pure returns (uint256) {
        return value * ONE_12_DP;
    }
}
