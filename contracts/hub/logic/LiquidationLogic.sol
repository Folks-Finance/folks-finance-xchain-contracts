// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "../libraries/DataTypes.sol";
import "../libraries/MathUtils.sol";
import "../LoanManagerState.sol";
import "../logic/LoanPoolLogic.sol";
import "../logic/UserLoanLogic.sol";
import "../logic/RewardLogic.sol";

library LiquidationLogic {
    using MathUtils for uint256;
    using LoanPoolLogic for LoanManagerState.LoanPool;
    using UserLoanLogic for LoanManagerState.UserLoan;

    error LoanTypeMismatch(uint16 violatorLoanTypeId, uint16 liquidatorLoanTypeId);
    error BorrowTypeMismatch(bytes32 violatorLoanId, bytes32 liquidatorLoanId, uint8 poolId);
    error UnderCollateralizedLoan(bytes32 loanId);
    error OverCollateralizedLoan(bytes32 loanId);
    error InsufficientSeized();
    error NoCollateralInLoanForPool(bytes32 loanId, uint8 poolId);
    error NoBorrowInLoanForPool(bytes32 loanId, uint8 poolId);

    /// @notice Updates violator and liquidator loans moving borrow from violator to liquidator in order to keep the loan healthy.
    /// @param loansParams LiquidationLoansParams struct including the violator and liquidator loan ids and the pool ids.
    /// @param borrowPoolParams BorrowPoolParams struct including the borrow pool's variable interest index and stable interest rate.
    /// @param repayBorrowAmount The amount to repay.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @return liquidationBorrowTransfer LiquidationBorrowTransfer struct including the amount paid, interest paid and excess paid.
    function updateLiquidationBorrows(
        DataTypes.LiquidationLoansParams memory loansParams,
        DataTypes.BorrowPoolParams memory borrowPoolParams,
        uint256 repayBorrowAmount,
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans
    ) external returns (DataTypes.LiquidationBorrowTransfer memory liquidationBorrowTransfer) {
        LoanManagerState.UserLoan storage violatorLoan = userLoans[loansParams.violatorLoanId];
        LoanManagerState.UserLoan storage liquidatorLoan = userLoans[loansParams.liquidatorLoanId];

        LoanManagerState.UserLoanBorrow storage violatorLoanBorrow = violatorLoan.borrows[loansParams.borrowPoolId];

        DataTypes.UpdateUserLoanBorrowParams memory updateLoanBorrowParams = DataTypes.UpdateUserLoanBorrowParams({
            poolId: loansParams.borrowPoolId,
            amount: 0,
            poolVariableInterestIndex: borrowPoolParams.variableInterestIndex,
            poolStableInterestRate: borrowPoolParams.stableInterestRate,
            isStableInterestRateToUpdate: false
        });

        (uint256 repaidBorrowAmount, uint256 repaidBorrowBalance, uint256 violatorStableRate) = UserLoanLogic
            .transferBorrowFromViolator(violatorLoan, loansParams.borrowPoolId, repayBorrowAmount);
        UserLoanLogic.transferBorrowToLiquidator(
            liquidatorLoan,
            updateLoanBorrowParams,
            repaidBorrowAmount,
            repaidBorrowBalance,
            violatorStableRate
        );

        liquidationBorrowTransfer.amountRepaid = repaidBorrowAmount;
        liquidationBorrowTransfer.balanceRepaid = repaidBorrowBalance;
        liquidationBorrowTransfer.isStable = violatorLoanBorrow.stableInterestRate > 0;
    }

    /// @notice Updates violator and liquidator loans moving the collateral seized.
    /// @param loansParams LiquidationLoansParams struct including the violator and liquidator loan ids and the pool ids.
    /// @param seizeCollateralFAmount The amount of collateral to seize.
    /// @param minSeized The minimum amount to seize acceptable for the liquidator.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @param loanTypes The mapping of the type ID to loan types data including a mapping with the pools' details.
    /// @return collateralSeized CollateralSeizedParams struct including the total amount, liquidator amount and reserve amount.
    function updateLiquidationCollaterals(
        DataTypes.LiquidationLoansParams memory loansParams,
        uint256 seizeCollateralFAmount,
        uint256 repayBorrowToCollateralFAmount,
        uint256 minSeized,
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 => LoanManagerState.LoanType) storage loanTypes
    ) external returns (DataTypes.CollateralSeizedParams memory collateralSeized) {
        LoanManagerState.UserLoan storage violatorLoan = userLoans[loansParams.violatorLoanId];
        LoanManagerState.UserLoan storage liquidatorLoan = userLoans[loansParams.liquidatorLoanId];

        uint8 colPoolId = loansParams.collateralPoolId;
        uint16 liquidationFee = loanTypes[violatorLoan.loanTypeId].pools[colPoolId].liquidationFee;
        collateralSeized = calcCollateralSeized(seizeCollateralFAmount, repayBorrowToCollateralFAmount, liquidationFee);

        if (collateralSeized.liquidatorAmount < minSeized) revert InsufficientSeized();

        violatorLoan.decreaseCollateral(colPoolId, collateralSeized.totalAmount);
        liquidatorLoan.increaseCollateral(colPoolId, collateralSeized.liquidatorAmount);
    }

    /// @notice Checks if the liquidation is possible and returns the violator's liquidity details.
    /// @param loansParams LiquidationLoansParams struct including the violator and liquidator loan ids, the pool ids and borrow type.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collaterals and borrows details.
    /// @param loanTypes The mapping of the type ID to loan types data including a mapping with the pools' details.
    /// @param pools The mapping of the pool ID to the pool contract.
    /// @param oracleManager The OracleManager contract.
    /// @return violatorLiquidity LoanLiquidityParams struct including the violator's liquidity: effective collateral value and effective borrow value.
    function prepareLiquidation(
        DataTypes.LiquidationLoansParams memory loansParams,
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 => LoanManagerState.LoanType) storage loanTypes,
        mapping(uint8 => IHubPool) storage pools,
        IOracleManager oracleManager
    ) external returns (DataTypes.LoanLiquidityParams memory violatorLiquidity) {
        LoanManagerState.UserLoan storage violatorLoan = userLoans[loansParams.violatorLoanId];
        LoanManagerState.UserLoan storage liquidatorLoan = userLoans[loansParams.liquidatorLoanId];
        LoanManagerState.LoanType storage loanType = loanTypes[violatorLoan.loanTypeId];
        uint8 collPoolId = loansParams.collateralPoolId;
        uint8 borrPoolId = loansParams.borrowPoolId;

        // user cannot repay borrow and seize collateral which they don't have
        // borrow/collateral present iff loan type created and pool added so no need to check this
        if (!violatorLoan.hasBorrowIn(borrPoolId)) revert NoBorrowInLoanForPool(loansParams.violatorLoanId, borrPoolId);
        if (!violatorLoan.hasCollateralIn(collPoolId))
            revert NoCollateralInLoanForPool(loansParams.violatorLoanId, collPoolId);

        // check loans are compatible
        if (violatorLoan.loanTypeId != liquidatorLoan.loanTypeId)
            revert LoanTypeMismatch(violatorLoan.loanTypeId, liquidatorLoan.loanTypeId);

        // if applicable, check borrows are compatible
        LoanManagerState.UserLoanBorrow storage violatorLoanBorrow = violatorLoan.borrows[borrPoolId];
        LoanManagerState.UserLoanBorrow storage liquidatorLoanBorrow = liquidatorLoan.borrows[borrPoolId];
        bool isViolatorStableBorrow = violatorLoanBorrow.stableInterestRate > 0;
        bool isLiquidatorStableBorrow = liquidatorLoanBorrow.stableInterestRate > 0;
        if (liquidatorLoanBorrow.balance > 0 && isViolatorStableBorrow != isLiquidatorStableBorrow)
            revert BorrowTypeMismatch(loansParams.violatorLoanId, loansParams.liquidatorLoanId, borrPoolId);

        // check loan is under-collateralized
        violatorLiquidity = violatorLoan.getLoanLiquidity(pools, loanType.pools, oracleManager);
        if (violatorLiquidity.effectiveCollateralValue >= violatorLiquidity.effectiveBorrowValue)
            revert OverCollateralizedLoan(loansParams.violatorLoanId);

        // update the violator borrow balance in anticipation of calc liquidation amounts
        UserLoanLogic.updateLoanBorrowInterests(
            violatorLoanBorrow,
            DataTypes.UpdateUserLoanBorrowParams({
                poolId: borrPoolId,
                amount: 0,
                poolVariableInterestIndex: pools[borrPoolId].getUpdatedVariableBorrowInterestIndex(),
                poolStableInterestRate: 0,
                isStableInterestRateToUpdate: false
            })
        );
    }

    /// @notice Checks if the liquidation is possible and returns the violator's liquidity details.
    /// @param loansParams LiquidationLoansParams struct including the violator and liquidator loan ids, the pool ids and borrow type.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collaterals and borrows details.
    /// @param loanTypes The loan type data including a mapping with the pools' details.
    /// @return maxRepayBorrowValue LiquidationAmountParams struct including max repay borrow amount and max seize collateral amount.
    function getMaxRepayBorrowValue(
        DataTypes.LiquidationLoansParams memory loansParams,
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 => LoanManagerState.LoanType) storage loanTypes,
        DataTypes.LoanLiquidityParams memory violatorLiquidity
    ) external view returns (uint256 maxRepayBorrowValue) {
        LoanManagerState.UserLoan storage violatorLoan = userLoans[loansParams.violatorLoanId];
        LoanManagerState.LoanType storage loanType = loanTypes[violatorLoan.loanTypeId];

        uint8 collPoolId = loansParams.collateralPoolId;
        uint8 borrPoolId = loansParams.borrowPoolId;

        LoanManagerState.LoanPool storage borrowLoanPool = loanType.pools[borrPoolId];
        uint256 collateralFactor = loanType.pools[collPoolId].collateralFactor;

        maxRepayBorrowValue = calcMaxRepayBorrowValue(
            violatorLiquidity,
            borrowLoanPool,
            collateralFactor,
            loanType.loanTargetHealth
        );
    }

    /// @notice Calculates the borrow amount to repay and the collateral amount to seize based on the violator's liquidity.
    /// @param loansParams LiquidationLoansParams struct including the violator and liquidator loan ids, the pool ids and borrow type.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collaterals and borrows details.
    /// @param loanTypes The loan type data including a mapping with the pools' details.
    /// @param collPool The pool contract of the collateral.
    /// @param oracleManager The OracleManager contract.
    /// @param maxRepayBorrowValue The maximum borrow value to repay.
    /// @param maxAmountToRepay The amount to repay set by the liquidator.
    /// @return liquidationAmounts LiquidationAmountParams struct including the repay borrow amount and seize collateral amount.
    function calcLiquidationAmounts(
        DataTypes.LiquidationLoansParams memory loansParams,
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 => LoanManagerState.LoanType) storage loanTypes,
        IHubPool collPool,
        IOracleManager oracleManager,
        uint256 maxRepayBorrowValue,
        uint256 maxAmountToRepay
    ) external view returns (DataTypes.LiquidationAmountParams memory liquidationAmounts) {
        LoanManagerState.UserLoan storage violatorLoan = userLoans[loansParams.violatorLoanId];

        uint8 collPoolId = loansParams.collateralPoolId;
        uint8 borrPoolId = loansParams.borrowPoolId;

        LoanManagerState.UserLoanCollateral storage violatorLoanCollateral = violatorLoan.collaterals[collPoolId];
        LoanManagerState.LoanPool storage borrowLoanPool = loanTypes[violatorLoan.loanTypeId].pools[borrPoolId];
        LoanManagerState.UserLoanBorrow storage violatorLoanBorrow = violatorLoan.borrows[borrPoolId];

        DataTypes.PriceFeed memory borrPriceFeed = oracleManager.processPriceFeed(borrPoolId);
        DataTypes.PriceFeed memory collPriceFeed = oracleManager.processPriceFeed(collPoolId);
        uint256 repayBorrowAmount;
        {
            uint256 maxRepayBorrowAmount = MathUtils.calcAssetAmount(
                maxRepayBorrowValue * MathUtils.ONE_10_DP,
                borrPriceFeed.price,
                borrPriceFeed.decimals
            );
            repayBorrowAmount = Math.min(maxAmountToRepay, Math.min(maxRepayBorrowAmount, violatorLoanBorrow.balance));
        }
        {
            uint256 seizeUnderlyingCollateralAmount = repayBorrowAmount.convToSeizedCollateralAmount(
                collPriceFeed.price,
                collPriceFeed.decimals,
                borrPriceFeed.price,
                borrPriceFeed.decimals,
                borrowLoanPool.liquidationBonus
            );
            uint256 collDepositInterestIndex = collPool.getUpdatedDepositInterestIndex();
            uint256 violatorUnderlingCollateralBalance = violatorLoanCollateral.balance.toUnderlingAmount(
                collDepositInterestIndex
            );
            if (seizeUnderlyingCollateralAmount > violatorUnderlingCollateralBalance) {
                seizeUnderlyingCollateralAmount = violatorUnderlingCollateralBalance;
                repayBorrowAmount = seizeUnderlyingCollateralAmount.convToRepayBorrowAmount(
                    collPriceFeed.price,
                    collPriceFeed.decimals,
                    borrPriceFeed.price,
                    borrPriceFeed.decimals,
                    borrowLoanPool.liquidationBonus
                );
            }

            liquidationAmounts.repayBorrowAmount = repayBorrowAmount;
            liquidationAmounts.repayBorrowToCollateralFAmount = repayBorrowAmount.convToCollateralFAmount(
                collPriceFeed.price,
                collPriceFeed.decimals,
                borrPriceFeed.price,
                borrPriceFeed.decimals,
                collDepositInterestIndex
            );
            liquidationAmounts.seizeCollateralFAmount = seizeUnderlyingCollateralAmount.toFAmount(
                collDepositInterestIndex,
                Math.Rounding.Floor
            );
        }
    }
    /// @dev Checks if the liquidator loan is over collateralized and the violator loan health is under the target.
    /// @param loansParams LiquidationLoansParams struct including the violator and liquidator loan ids and the pool ids.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @param loanTypes The mapping of the type ID to loan types data including a mapping with the pools' details.
    /// @param pools The mapping of the pool ID to the pool contract.
    /// @param oracleManager The OracleManager contract.
    function checkLiquidatorLoan(
        DataTypes.LiquidationLoansParams memory loansParams,
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 => LoanManagerState.LoanType) storage loanTypes,
        mapping(uint8 => IHubPool) storage pools,
        IOracleManager oracleManager
    ) external view {
        LoanManagerState.UserLoan storage liquidatorLoan = userLoans[loansParams.liquidatorLoanId];
        if (!liquidatorLoan.isLoanOverCollateralized(pools, loanTypes[liquidatorLoan.loanTypeId].pools, oracleManager))
            revert UnderCollateralizedLoan(loansParams.liquidatorLoanId);
    }

    /// @dev Calculates the maximum borrow value to repay based on the violator's liquidity.
    /// @param violatorLiquidity LoanLiquidityParams struct including the violator's liquidity: effective collateral value and effective borrow value.
    /// @param borrowLoanPool The loan pool of the borrow.
    /// @param collateralFactor 4dp - The collateral factor of the collateral.
    /// @param loanTargetHealth 4dp - The target health of the loan.
    /// @return maxRepayBorrowValue The maximum borrow value to repay.
    function calcMaxRepayBorrowValue(
        DataTypes.LoanLiquidityParams memory violatorLiquidity,
        LoanManagerState.LoanPool storage borrowLoanPool,
        uint256 collateralFactor,
        uint32 loanTargetHealth
    ) internal view returns (uint256 maxRepayBorrowValue) {
        uint256 effectiveBorrowValueTarget = violatorLiquidity.effectiveBorrowValue.calcBorrowValueTarget(
            loanTargetHealth
        );

        uint256 borrowAdjustFactor = (loanTargetHealth * borrowLoanPool.borrowFactor) / MathUtils.ONE_4_DP;
        uint256 collateralAdjustFactor = (collateralFactor * (MathUtils.ONE_4_DP + borrowLoanPool.liquidationBonus)) /
            MathUtils.ONE_4_DP;

        maxRepayBorrowValue =
            ((effectiveBorrowValueTarget - violatorLiquidity.effectiveCollateralValue) * MathUtils.ONE_4_DP) /
            (borrowAdjustFactor - collateralAdjustFactor);
    }

    /// @dev Calculates the collateral fAmounts to seize: total, reserve and liquidator amounts.
    /// @param liquidationFee 4dp - The liquidation fee of the collateral.
    /// @param seizeCollateralFAmount The amount of collateral to seize.
    /// @return collateralSeized CollateralSeizedParams struct including the total amount, liquidator amount and reserve amount.
    function calcCollateralSeized(
        uint256 seizeCollateralFAmount,
        uint256 repayBorrowToCollateralFAmount,
        uint16 liquidationFee
    ) internal pure returns (DataTypes.CollateralSeizedParams memory collateralSeized) {
        collateralSeized.totalAmount = seizeCollateralFAmount;
        collateralSeized.reserveAmount = collateralSeized.totalAmount.calcReserveCol(
            repayBorrowToCollateralFAmount,
            liquidationFee
        );
        collateralSeized.liquidatorAmount = collateralSeized.totalAmount - collateralSeized.reserveAmount;
    }

    function updateLiquidationRewards(
        DataTypes.LiquidationLoansParams memory params,
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 loanTypeId => LoanManagerState.LoanType) storage loanTypes,
        mapping(bytes32 accountId => mapping(uint8 poolId => LoanManagerState.UserPoolRewards)) storage userPoolRewards
    ) internal {
        LoanManagerState.UserLoan storage liquidatorLoan = userLoans[params.liquidatorLoanId];
        LoanManagerState.UserLoan storage violatorLoan = userLoans[params.violatorLoanId];
        LoanManagerState.LoanType storage loanType = loanTypes[liquidatorLoan.loanTypeId];
        LoanManagerState.LoanPool storage collateralLoanPool = loanType.pools[params.collateralPoolId];
        LoanManagerState.LoanPool storage borrowLoanPool = loanType.pools[params.borrowPoolId];

        RewardLogic.updateRewardIndexes(collateralLoanPool, params.collateralPoolId);
        RewardLogic.updateRewardIndexes(borrowLoanPool, params.borrowPoolId);

        RewardLogic.updateUserCollateralReward(
            userPoolRewards,
            liquidatorLoan,
            collateralLoanPool,
            params.collateralPoolId
        );
        RewardLogic.updateUserBorrowReward(userPoolRewards, liquidatorLoan, borrowLoanPool, params.borrowPoolId);
        RewardLogic.updateUserCollateralReward(
            userPoolRewards,
            violatorLoan,
            collateralLoanPool,
            params.collateralPoolId
        );
        RewardLogic.updateUserBorrowReward(userPoolRewards, violatorLoan, borrowLoanPool, params.borrowPoolId);
    }
}
