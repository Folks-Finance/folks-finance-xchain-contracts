// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../libraries/DataTypes.sol";
import "../libraries/MathUtils.sol";
import "../HubPoolState.sol";

library HubPoolLogic {
    event InterestIndexesUpdated(
        uint256 variableBorrowInterestIndex,
        uint256 depositInterestIndex,
        uint256 lastUpdateTimestamp
    );
    event InterestRatesUpdated(
        uint256 variableBorrowInterestRate,
        uint256 stableBorrowInterestRate,
        uint256 depositInterestRate
    );

    error DeprecatedPool();
    error CannotMintFToken();
    error DepositCapReached();
    error BorrowCapReached();
    error InsufficientLiquidity();
    error StableBorrowPercentageCapExceeded();
    error StableBorrowNotSupported();
    error MaxStableRateExceeded(uint256 actual, uint256 max);
    error RebalanceUpUtilisationRatioNotReached();
    error RebalanceUpThresholdNotReached();

    using Math for uint256;
    using MathUtils for uint256;
    using HubPoolLogic for HubPoolState.PoolData;

    function updateWithDeposit(
        HubPoolState.PoolData storage pool,
        uint256 amount,
        DataTypes.PriceFeed memory priceFeed
    ) external returns (DataTypes.DepositPoolParams memory depositPoolParams) {
        if (pool.isDeprecated()) revert DeprecatedPool();
        if (pool.isDepositCapReached(priceFeed, amount)) revert DepositCapReached();

        // update interest indexes before the interest rates change
        pool.updateInterestIndexes();

        uint256 depositInterestIndex = pool.depositData.interestIndex;
        depositPoolParams.fAmount = amount.toFAmount(depositInterestIndex, Math.Rounding.Floor);
        depositPoolParams.depositInterestIndex = depositInterestIndex;
        depositPoolParams.priceFeed = priceFeed;

        pool.depositData.totalAmount += amount;
        pool.updateInterestRates();
    }

    function prepareForWithdraw(
        HubPoolState.PoolData storage pool,
        uint256 amount,
        bool isFAmount
    ) external returns (DataTypes.WithdrawPoolParams memory withdrawPoolParams) {
        // can withdraw even if pool is depreciated
        // update interest indexes before the interest rates change
        pool.updateInterestIndexes();

        if (isFAmount) {
            withdrawPoolParams.fAmount = amount;
            withdrawPoolParams.underlingAmount = amount.toUnderlingAmount(pool.depositData.interestIndex);
        } else {
            withdrawPoolParams.underlingAmount = amount;
            withdrawPoolParams.fAmount = amount.toFAmount(pool.depositData.interestIndex, Math.Rounding.Ceil);
        }

        uint256 totalDebt = pool.variableBorrowData.totalAmount + pool.stableBorrowData.totalAmount;
        if (
            withdrawPoolParams.underlingAmount >
            MathUtils.calcAvailableLiquidity(totalDebt, pool.depositData.totalAmount)
        ) revert InsufficientLiquidity();
    }

    function updateWithWithdraw(HubPoolState.PoolData storage pool, uint256 underlyingAmount) external {
        pool.depositData.totalAmount -= underlyingAmount;
        pool.updateInterestRates();
    }

    function prepareForWithdrawFToken(HubPoolState.PoolData storage pool) external view {
        if (pool.isDeprecated()) revert DeprecatedPool();
        if (!pool.canMintFToken()) revert CannotMintFToken();
    }

    function prepareForBorrow(
        HubPoolState.PoolData storage pool,
        uint256 amount,
        DataTypes.PriceFeed memory priceFeed,
        uint256 maxStableRate
    ) external returns (DataTypes.BorrowPoolParams memory borrowPoolParams) {
        if (pool.isDeprecated()) revert DeprecatedPool();

        bool isStable = maxStableRate > 0;
        uint256 stableBorrowInterestRate = pool.stableBorrowData.interestRate;
        uint256 totalDebt = pool.variableBorrowData.totalAmount + pool.stableBorrowData.totalAmount;
        if (amount > MathUtils.calcAvailableLiquidity(totalDebt, pool.depositData.totalAmount))
            revert InsufficientLiquidity();
        if (isStable && !pool.isStableBorrowSupported()) revert StableBorrowNotSupported();
        if (pool.isBorrowCapReached(priceFeed, amount)) revert BorrowCapReached();
        if (isStable && pool.isStableBorrowCapExceeded(amount)) revert StableBorrowPercentageCapExceeded();
        if (isStable && stableBorrowInterestRate > maxStableRate)
            revert MaxStableRateExceeded(stableBorrowInterestRate, maxStableRate);

        // update interest indexes before the interest rates change
        pool.updateInterestIndexes();

        borrowPoolParams.variableInterestIndex = pool.variableBorrowData.interestIndex;
        borrowPoolParams.stableInterestRate = stableBorrowInterestRate;
    }

    function updateWithBorrow(HubPoolState.PoolData storage pool, uint256 amount, bool isStable) external {
        if (isStable) {
            pool.stableBorrowData.averageInterestRate = MathUtils.calcIncreasingAverageStableBorrowInterestRate(
                amount,
                pool.stableBorrowData.interestRate,
                pool.stableBorrowData.totalAmount,
                pool.stableBorrowData.averageInterestRate
            );
            pool.stableBorrowData.totalAmount += amount;
        } else pool.variableBorrowData.totalAmount += amount;

        pool.updateInterestRates();
    }

    function prepareForRepay(
        HubPoolState.PoolData storage pool
    ) external returns (DataTypes.BorrowPoolParams memory borrowPoolParams) {
        // can repay even if pool is depreciated
        pool.updateInterestIndexes();

        borrowPoolParams.variableInterestIndex = pool.variableBorrowData.interestIndex;
        borrowPoolParams.stableInterestRate = pool.stableBorrowData.interestRate;
    }

    function updateWithRepay(
        HubPoolState.PoolData storage pool,
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 loanStableRate,
        uint256 excessAmount
    ) external {
        if (loanStableRate > 0) {
            pool.stableBorrowData.averageInterestRate = MathUtils.calcDecreasingAverageStableBorrowInterestRate(
                principalPaid,
                loanStableRate,
                pool.stableBorrowData.totalAmount,
                pool.stableBorrowData.averageInterestRate
            );
            pool.stableBorrowData.totalAmount -= principalPaid;
        } else pool.variableBorrowData.totalAmount -= principalPaid;

        pool.feeData.totalRetainedAmount += excessAmount;
        pool.depositData.totalAmount += interestPaid + excessAmount;

        pool.updateInterestRates();
    }

    function updateWithRepayWithCollateral(
        HubPoolState.PoolData storage pool,
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 loanStableRate
    ) external returns (DataTypes.RepayWithCollateralPoolParams memory repayWithCollateralPoolParams) {
        if (loanStableRate > 0) {
            pool.stableBorrowData.averageInterestRate = MathUtils.calcDecreasingAverageStableBorrowInterestRate(
                principalPaid,
                loanStableRate,
                pool.stableBorrowData.totalAmount,
                pool.stableBorrowData.averageInterestRate
            );
            pool.stableBorrowData.totalAmount -= principalPaid;
        } else pool.variableBorrowData.totalAmount -= principalPaid;

        pool.depositData.totalAmount -= principalPaid;
        repayWithCollateralPoolParams.fAmount = (principalPaid + interestPaid).toFAmount(
            pool.depositData.interestIndex,
            Math.Rounding.Ceil
        );

        pool.updateInterestRates();
    }

    function updateWithLiquidation(HubPoolState.PoolData storage pool) external {
        pool.updateInterestRates();
    }

    function prepareForSwitchBorrowType(
        HubPoolState.PoolData storage pool,
        uint256 amount,
        uint256 maxStableRate
    ) external returns (DataTypes.BorrowPoolParams memory borrowPoolParams) {
        if (pool.isDeprecated()) revert DeprecatedPool();

        bool isStable = maxStableRate > 0;
        uint256 stableBorrowInterestRate = pool.stableBorrowData.interestRate;
        if (isStable && !pool.isStableBorrowSupported()) revert StableBorrowNotSupported();
        if (isStable && pool.isStableBorrowCapExceeded(amount)) revert StableBorrowPercentageCapExceeded();
        if (isStable && stableBorrowInterestRate > maxStableRate)
            revert MaxStableRateExceeded(stableBorrowInterestRate, maxStableRate);

        // update interest indexes before the interest rates change
        pool.updateInterestIndexes();

        borrowPoolParams.variableInterestIndex = pool.variableBorrowData.interestIndex;
        borrowPoolParams.stableInterestRate = stableBorrowInterestRate;
    }

    function updateWithSwitchBorrowType(
        HubPoolState.PoolData storage pool,
        uint256 amount,
        bool switchingToStable,
        uint256 oldLoanBorrowStableRate
    ) external {
        if (switchingToStable) {
            pool.stableBorrowData.averageInterestRate = MathUtils.calcIncreasingAverageStableBorrowInterestRate(
                amount,
                pool.stableBorrowData.interestRate,
                pool.stableBorrowData.totalAmount,
                pool.stableBorrowData.averageInterestRate
            );
            pool.stableBorrowData.totalAmount += amount;
            pool.variableBorrowData.totalAmount -= amount;
        } else {
            pool.stableBorrowData.averageInterestRate = MathUtils.calcDecreasingAverageStableBorrowInterestRate(
                amount,
                oldLoanBorrowStableRate,
                pool.stableBorrowData.totalAmount,
                pool.stableBorrowData.averageInterestRate
            );
            pool.stableBorrowData.totalAmount -= amount;
            pool.variableBorrowData.totalAmount += amount;
        }

        pool.updateInterestRates();
    }

    function prepareForRebalanceUp(
        HubPoolState.PoolData storage pool
    ) external returns (DataTypes.BorrowPoolParams memory borrowPoolParams) {
        // can rebalance even if pool is depreciated
        // update interest indexes before the interest rates change
        pool.updateInterestIndexes();

        uint256 utilizationRatio = MathUtils.calcUtilisationRatio(
            pool.variableBorrowData.totalAmount + pool.stableBorrowData.totalAmount,
            pool.depositData.totalAmount
        );
        uint256 rebalanceUpThreshold = MathUtils.calcRebalanceUpThreshold(
            pool.stableBorrowData.rebalanceUpDepositInterestRate,
            pool.variableBorrowData.vr0,
            pool.variableBorrowData.vr1,
            pool.variableBorrowData.vr2
        );

        // check conditions for rebalance
        if (utilizationRatio < MathUtils.from4DPto18DP(pool.stableBorrowData.rebalanceUpUtilisationRatio))
            revert RebalanceUpUtilisationRatioNotReached();
        if (rebalanceUpThreshold < pool.depositData.interestRate) revert RebalanceUpThresholdNotReached();

        borrowPoolParams.variableInterestIndex = pool.variableBorrowData.interestIndex;
        borrowPoolParams.stableInterestRate = pool.stableBorrowData.interestRate;
    }

    function updateWithRebalanceUp(
        HubPoolState.PoolData storage pool,
        uint256 amount,
        uint256 oldLoanStableInterestRate
    ) external {
        uint256 stableBorrowAverageInterestRate = pool.stableBorrowData.averageInterestRate;
        uint256 stableBorrowTotalAmount = pool.stableBorrowData.totalAmount;

        stableBorrowAverageInterestRate = MathUtils.calcDecreasingAverageStableBorrowInterestRate(
            amount,
            oldLoanStableInterestRate,
            stableBorrowTotalAmount,
            stableBorrowAverageInterestRate
        );
        stableBorrowTotalAmount -= amount;

        stableBorrowAverageInterestRate = MathUtils.calcIncreasingAverageStableBorrowInterestRate(
            amount,
            pool.stableBorrowData.interestRate,
            stableBorrowTotalAmount,
            stableBorrowAverageInterestRate
        );
        stableBorrowTotalAmount += amount;

        pool.stableBorrowData.averageInterestRate = stableBorrowAverageInterestRate;
        pool.stableBorrowData.totalAmount = stableBorrowTotalAmount;

        pool.updateInterestRates();
    }

    function prepareForRebalanceDown(
        HubPoolState.PoolData storage pool
    ) external returns (DataTypes.RebalanceDownPoolParams memory rebalanceDownPoolParams) {
        // can rebalance even if pool is depreciated
        // update interest indexes before the interest rates change
        pool.updateInterestIndexes();

        rebalanceDownPoolParams.variableInterestIndex = pool.variableBorrowData.interestIndex;
        rebalanceDownPoolParams.stableInterestRate = pool.stableBorrowData.interestRate;
        rebalanceDownPoolParams.threshold = MathUtils.calcRebalanceDownThreshold(
            pool.stableBorrowData.rebalanceDownDelta,
            rebalanceDownPoolParams.stableInterestRate
        );
    }

    function updateWithRebalanceDown(
        HubPoolState.PoolData storage pool,
        uint256 amount,
        uint256 oldLoanStableInterestRate
    ) external {
        uint256 stableBorrowAverageInterestRate = pool.stableBorrowData.averageInterestRate;
        uint256 stableBorrowTotalAmount = pool.stableBorrowData.totalAmount;

        stableBorrowAverageInterestRate = MathUtils.calcDecreasingAverageStableBorrowInterestRate(
            amount,
            oldLoanStableInterestRate,
            stableBorrowTotalAmount,
            stableBorrowAverageInterestRate
        );
        stableBorrowTotalAmount -= amount;

        stableBorrowAverageInterestRate = MathUtils.calcIncreasingAverageStableBorrowInterestRate(
            amount,
            pool.stableBorrowData.interestRate,
            stableBorrowTotalAmount,
            stableBorrowAverageInterestRate
        );
        stableBorrowTotalAmount += amount;

        pool.stableBorrowData.averageInterestRate = stableBorrowAverageInterestRate;
        pool.stableBorrowData.totalAmount = stableBorrowTotalAmount;

        pool.updateInterestRates();
    }

    function getUpdatedDepositInterestIndex(HubPoolState.PoolData storage poolData) external view returns (uint256) {
        return
            MathUtils.calcDepositInterestIndex(
                poolData.depositData.interestRate,
                poolData.depositData.interestIndex,
                block.timestamp - poolData.lastUpdateTimestamp
            );
    }

    function getUpdatedVariableBorrowInterestIndex(
        HubPoolState.PoolData storage poolData
    ) external view returns (uint256) {
        return
            MathUtils.calcBorrowInterestIndex(
                poolData.variableBorrowData.interestRate,
                poolData.variableBorrowData.interestIndex,
                block.timestamp - poolData.lastUpdateTimestamp
            );
    }

    function updateInterestIndexes(HubPoolState.PoolData storage poolData) internal {
        HubPoolState.PoolAmountDataCache memory poolAmountDataCache = getPoolAmountDataCache(poolData);
        uint256 timeDelta = block.timestamp - poolData.lastUpdateTimestamp;
        uint256 totalDebt = poolAmountDataCache.variableBorrowTotalAmount + poolAmountDataCache.stableBorrowTotalAmount;
        uint256 variableBorrowInterestRate = poolData.variableBorrowData.interestRate;

        // update total retained amount
        poolData.feeData.totalRetainedAmount = MathUtils.calcRetention(
            poolData.feeData.totalRetainedAmount,
            totalDebt,
            MathUtils.calcOverallBorrowInterestRate(
                poolAmountDataCache.variableBorrowTotalAmount,
                poolAmountDataCache.stableBorrowTotalAmount,
                variableBorrowInterestRate,
                poolData.stableBorrowData.averageInterestRate
            ),
            poolData.feeData.retentionRate,
            timeDelta
        );

        // calculate new interest indexes
        uint256 variableBorrowInterestIndex = MathUtils.calcBorrowInterestIndex(
            variableBorrowInterestRate,
            poolData.variableBorrowData.interestIndex,
            timeDelta
        );
        uint256 depositInterestIndex = MathUtils.calcDepositInterestIndex(
            poolData.depositData.interestRate,
            poolData.depositData.interestIndex,
            timeDelta
        );
        uint256 lastUpdateTimestamp = block.timestamp;

        // update interest indexes
        poolData.variableBorrowData.interestIndex = variableBorrowInterestIndex;
        poolData.depositData.interestIndex = depositInterestIndex;
        poolData.lastUpdateTimestamp = lastUpdateTimestamp;

        emit InterestIndexesUpdated(variableBorrowInterestIndex, depositInterestIndex, lastUpdateTimestamp);
    }

    function updateInterestRates(HubPoolState.PoolData storage poolData) internal {
        HubPoolState.PoolAmountDataCache memory poolAmountDataCache = getPoolAmountDataCache(poolData);
        uint256 totalDebt = poolAmountDataCache.variableBorrowTotalAmount + poolAmountDataCache.stableBorrowTotalAmount;
        uint256 utilisationRatio = MathUtils.calcUtilisationRatio(totalDebt, poolData.depositData.totalAmount);
        uint32 vr1 = poolData.variableBorrowData.vr1;

        // calculate new interest rates
        uint256 variableBorrowInterestRate = MathUtils.calcVariableBorrowInterestRate(
            poolData.variableBorrowData.vr0,
            vr1,
            poolData.variableBorrowData.vr2,
            utilisationRatio,
            poolData.depositData.optimalUtilisationRatio
        );
        uint256 stableBorrowInterestRate = MathUtils.calcStableBorrowInterestRate(
            vr1,
            poolData.stableBorrowData.sr0,
            poolData.stableBorrowData.sr1,
            poolData.stableBorrowData.sr2,
            poolData.stableBorrowData.sr3,
            utilisationRatio,
            poolData.depositData.optimalUtilisationRatio,
            MathUtils.calcStableDebtToTotalDebtRatio(poolAmountDataCache.stableBorrowTotalAmount, totalDebt),
            poolData.stableBorrowData.optimalStableToTotalDebtRatio
        );
        uint256 depositInterestRate = MathUtils.calcDepositInterestRate(
            utilisationRatio,
            MathUtils.calcOverallBorrowInterestRate(
                poolAmountDataCache.variableBorrowTotalAmount,
                poolAmountDataCache.stableBorrowTotalAmount,
                variableBorrowInterestRate,
                poolData.stableBorrowData.averageInterestRate
            ),
            poolData.feeData.retentionRate
        );

        // update interest rates
        poolData.variableBorrowData.interestRate = variableBorrowInterestRate;
        poolData.stableBorrowData.interestRate = stableBorrowInterestRate;
        poolData.depositData.interestRate = depositInterestRate;

        emit InterestRatesUpdated(variableBorrowInterestRate, stableBorrowInterestRate, depositInterestRate);
    }

    function isDeprecated(HubPoolState.PoolData storage poolData) internal view returns (bool) {
        return poolData.configData.deprecated;
    }

    function isStableBorrowSupported(HubPoolState.PoolData storage poolData) internal view returns (bool) {
        return poolData.configData.stableBorrowSupported;
    }

    function isFlashLoanSupported(HubPoolState.PoolData storage poolData) internal view returns (bool) {
        return poolData.configData.flashLoanSupported;
    }

    function canMintFToken(HubPoolState.PoolData storage poolData) internal view returns (bool) {
        return poolData.configData.canMintFToken;
    }

    function isDepositCapReached(
        HubPoolState.PoolData storage poolData,
        DataTypes.PriceFeed memory priceFeed,
        uint256 amountToDeposit
    ) internal view returns (bool) {
        return
            (poolData.depositData.totalAmount + amountToDeposit).calcAssetDollarValueRoundedUp(
                priceFeed.price,
                priceFeed.decimals
            ) > MathUtils.from0DPto18DP(poolData.capsData.deposit);
    }

    function isBorrowCapReached(
        HubPoolState.PoolData storage poolData,
        DataTypes.PriceFeed memory priceFeed,
        uint256 amountToBorrow
    ) internal view returns (bool) {
        uint256 totalDebt = poolData.variableBorrowData.totalAmount + poolData.stableBorrowData.totalAmount;
        return
            (totalDebt + amountToBorrow).calcAssetDollarValueRoundedUp(priceFeed.price, priceFeed.decimals) >
            MathUtils.from0DPto18DP(poolData.capsData.borrow);
    }

    function isStableBorrowCapExceeded(
        HubPoolState.PoolData storage poolData,
        uint256 amountToBorrow
    ) internal view returns (bool) {
        uint256 totalDebt = poolData.variableBorrowData.totalAmount + poolData.stableBorrowData.totalAmount;
        return
            amountToBorrow.calcStableBorrowRatio(
                MathUtils.calcAvailableLiquidity(totalDebt, poolData.depositData.totalAmount)
            ) > poolData.capsData.stableBorrowPercentage;
    }

    function getPoolAmountDataCache(
        HubPoolState.PoolData storage poolData
    ) private view returns (HubPoolState.PoolAmountDataCache memory poolAmountDataCache) {
        poolAmountDataCache.stableBorrowTotalAmount = poolData.stableBorrowData.totalAmount;
        poolAmountDataCache.variableBorrowTotalAmount = poolData.variableBorrowData.totalAmount;
    }
}
