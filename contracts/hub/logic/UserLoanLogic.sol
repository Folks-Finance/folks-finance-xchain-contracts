// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../libraries/DataTypes.sol";
import "../libraries/MathUtils.sol";
import "../LoanManagerState.sol";

library UserLoanLogic {
    using MathUtils for uint256;

    error BorrowTypeMismatch();
    error RepaidBorrowBalanceIsZero();

    /// @notice Increase the collateral of a loan
    /// @dev Init, adding the new pool to the user collateral list, or update the collateral amount
    /// @param loan The user loan to increase the collateral amount
    /// @param poolId The pool ID of the collateral
    /// @param fAmount The amount in f token to increase the balance by
    function increaseCollateral(LoanManagerState.UserLoan storage loan, uint8 poolId, uint256 fAmount) external {
        // ignore increase by zero amount
        if (fAmount == 0) return;

        // if the balance was prev zero, add pool to list of user loan collaterals
        if (loan.collaterals[poolId].balance == 0) loan.colPools.push(poolId);

        loan.collaterals[poolId].balance += fAmount;
    }

    /// @notice Decrease the collateral of a loan
    /// @dev Update the collateral amount, if the remaining balance is 0 delete the pool from the user collateral list
    /// @param loan The user loan to decrease the collateral amount
    /// @param poolId The pool ID of the collateral
    /// @param fAmount The amount in f token to decrease the balance by
    function decreaseCollateral(LoanManagerState.UserLoan storage loan, uint8 poolId, uint256 fAmount) external {
        loan.collaterals[poolId].balance -= fAmount;

        // if the balance is now zero, remove pool from list of user loan collaterals
        if (loan.collaterals[poolId].balance == 0) {
            uint256 colPoolsLength = loan.colPools.length;
            for (uint8 i = 0; i < colPoolsLength; ) {
                if (loan.colPools[i] == poolId) {
                    loan.colPools[i] = loan.colPools[colPoolsLength - 1];
                    loan.colPools.pop();
                    delete loan.collaterals[poolId];
                    break;
                }
                unchecked {
                    ++i;
                }
            }
        }
    }

    /// @notice Increase the borrow of a loan
    /// @dev Init, adding the new pool to the user borrow list, or update the borrow amount, balance and interests
    /// @param loan The user loan to increase the borrow amount
    /// @param params The borrow update param including the pool ID, borrow type and amount, and pool's interests
    function increaseBorrow(
        LoanManagerState.UserLoan storage loan,
        DataTypes.UpdateUserLoanBorrowParams memory params,
        bool isStable
    ) external {
        LoanManagerState.UserLoanBorrow storage loanBorrow = loan.borrows[params.poolId];

        // ignore increase by zero amount
        if (params.amount == 0) return;

        // if the balance was prev zero then initialise, else update
        if (loanBorrow.balance == 0) {
            initLoanBorrowInterests(loanBorrow, params, isStable);
            loanBorrow.amount = params.amount;
            loanBorrow.balance = params.amount;
            loan.borPools.push(params.poolId);
        } else {
            if (isStable != loanBorrow.stableInterestRate > 0) revert BorrowTypeMismatch();
            updateLoanBorrowInterests(loanBorrow, params);

            // update amount
            loanBorrow.amount += params.amount;
            loanBorrow.balance += params.amount;
        }
    }

    /// @notice Decrease the borrow of a loan
    /// @dev Update the borrow amount, balance and interests, if the remaining balance is 0 delete the pool from the user borrow list
    /// @param loan The user loan to decrease the borrow amount
    /// @param params The borrow update param including the pool ID, borrow type and amount, and pool's interests
    /// @return principalPaid The principal paid to decrease the borrow amouont (excl interest)
    /// @return interestPaid The interest paid
    /// @return excessPaid The excess amount paid
    function decreaseBorrow(
        LoanManagerState.UserLoan storage loan,
        DataTypes.UpdateUserLoanBorrowParams memory params
    ) external returns (uint256 principalPaid, uint256 interestPaid, uint256 excessPaid, uint256 loanStableRate) {
        LoanManagerState.UserLoanBorrow storage loanBorrow = loan.borrows[params.poolId];

        loanStableRate = loanBorrow.stableInterestRate;

        updateLoanBorrowInterests(loanBorrow, params);

        uint256 balance = loanBorrow.balance;
        uint256 interest = balance - loanBorrow.amount;
        excessPaid = params.amount > balance ? params.amount - balance : 0;
        interestPaid = Math.min(params.amount, interest);

        principalPaid = params.amount - interestPaid - excessPaid;

        loanBorrow.amount -= principalPaid;
        balance -= principalPaid + interestPaid;

        if (balance == 0) clearBorrow(loan, params.poolId);
        loanBorrow.balance = balance;
    }

    /// @dev Calc the borrow balance and amount to repay and decrease them from violator borrow
    /// @param loan The user loan to transfer the borrow from
    /// @param poolId The pool ID of the borrow
    /// @param repayBorrowAmount The amount to repay
    /// @return repaidBorrowAmount The borrow amount repaid
    /// @return repaidBorrowBalance The borrow balance repaid
    function transferBorrowFromViolator(
        LoanManagerState.UserLoan storage loan,
        uint8 poolId,
        uint256 repayBorrowAmount
    ) external returns (uint256 repaidBorrowAmount, uint256 repaidBorrowBalance, uint256 loanStableRate) {
        LoanManagerState.UserLoanBorrow storage loanBorrow = loan.borrows[poolId];

        // violator loanBorrow has beed updated in prepareLiquidation

        repaidBorrowBalance = repayBorrowAmount;
        repaidBorrowAmount = Math.min(repaidBorrowBalance, loanBorrow.amount);
        loanStableRate = loanBorrow.stableInterestRate;

        loanBorrow.amount -= repaidBorrowAmount;
        loanBorrow.balance -= repaidBorrowBalance;

        if (loanBorrow.balance == 0) clearBorrow(loan, poolId);
    }

    /// @dev Transfer the decreased borrow from violator to liquidator
    /// @param loan The user loan to transfer the borrow to
    /// @param params The borrow update param including the pool ID, borrow type and amount, and pool's interests
    /// @param repaidBorrowAmount The borrow amount repaid
    /// @param repaidBorrowBalance The borrow balance repaid
    function transferBorrowToLiquidator(
        LoanManagerState.UserLoan storage loan,
        DataTypes.UpdateUserLoanBorrowParams memory params,
        uint256 repaidBorrowAmount,
        uint256 repaidBorrowBalance,
        uint256 violatorStableRate
    ) external {
        LoanManagerState.UserLoanBorrow storage loanBorrow = loan.borrows[params.poolId];
        bool isStable = violatorStableRate > 0;

        // safeguard against zero amount
        if (repaidBorrowBalance == 0) revert RepaidBorrowBalanceIsZero();

        // if the balance was prev zero then initialise, else update
        if (loanBorrow.balance == 0) {
            initLoanBorrowInterests(loanBorrow, params, isStable);
            if (isStable) loanBorrow.stableInterestRate = violatorStableRate;
            loan.borPools.push(params.poolId);
        } else {
            updateLoanBorrowInterests(loanBorrow, params);
            if (isStable)
                loanBorrow.stableInterestRate = MathUtils.calcAverageStableRate(
                    loanBorrow.amount,
                    loanBorrow.stableInterestRate,
                    repaidBorrowAmount,
                    violatorStableRate
                );
        }
        loanBorrow.amount += repaidBorrowAmount;
        loanBorrow.balance += repaidBorrowBalance;
    }

    /// @dev Switch the borrow type of a loan from stable to variable or vice versa
    /// @param loan The user loan to switch the borrow type
    /// @param params The borrow update param including the pool ID, borrow type and amount, and pool's interests
    /// @return oldLoanBorrowStableRate The loan borrow stable rate before switch
    function switchBorrowType(
        LoanManagerState.UserLoan storage loan,
        DataTypes.UpdateUserLoanBorrowTypeParams memory params
    ) external returns (uint256 oldLoanBorrowStableRate) {
        LoanManagerState.UserLoanBorrow storage loanBorrow = loan.borrows[params.poolId];

        DataTypes.UpdateUserLoanBorrowParams memory updateBorrowParams = DataTypes.UpdateUserLoanBorrowParams({
            poolId: params.poolId,
            amount: 0,
            poolVariableInterestIndex: params.poolVariableInterestIndex,
            poolStableInterestRate: params.poolStableInterestRate,
            isStableInterestRateToUpdate: false
        });

        oldLoanBorrowStableRate = loanBorrow.stableInterestRate;

        // update current borrow loan interests
        updateLoanBorrowInterests(loanBorrow, updateBorrowParams);

        // update to new borrow type and init new borrow
        initLoanBorrowInterests(loanBorrow, updateBorrowParams, params.switchingToStable);
    }

    function hasCollateralIn(LoanManagerState.UserLoan storage loan, uint8 poolId) internal view returns (bool) {
        return loan.collaterals[poolId].balance > 0;
    }

    function hasBorrowIn(LoanManagerState.UserLoan storage loan, uint8 poolId) internal view returns (bool) {
        return loan.borrows[poolId].balance > 0;
    }

    function hasStableBorrowIn(LoanManagerState.UserLoan storage loan, uint8 poolId) internal view returns (bool) {
        return loan.borrows[poolId].balance > 0 && loan.borrows[poolId].stableInterestRate > 0;
    }

    function hasVariableBorrowIn(LoanManagerState.UserLoan storage loan, uint8 poolId) internal view returns (bool) {
        return loan.borrows[poolId].balance > 0 && loan.borrows[poolId].stableInterestRate == 0;
    }

    /// @notice Get the effective collateral and borrow value of a loan
    /// @dev The effective value is the value of the collateral and borrow considering the price, interest and coll and borr factors
    /// @param loan The loan to get the liquidity
    /// @param pools The mapping of the pool ID to the pool contract.
    /// @param loanPools The mapping of the pool ID to the loan pool data.
    /// @param oracleManager The OracleManager contract.
    /// @return loanLiquidity The effective collateral and borrow value of the loan.
    function getLoanLiquidity(
        LoanManagerState.UserLoan storage loan,
        mapping(uint8 => IHubPool) storage pools,
        mapping(uint8 => LoanManagerState.LoanPool) storage loanPools,
        IOracleManager oracleManager
    ) internal view returns (DataTypes.LoanLiquidityParams memory loanLiquidity) {
        // declare common variables
        uint256 effectiveValue;
        uint256 balance;
        uint8 poolId;
        uint256 poolsLength;
        DataTypes.PriceFeed memory priceFeed;

        // calc effective collateral value
        poolsLength = loan.colPools.length;
        for (uint8 i = 0; i < poolsLength; i++) {
            poolId = loan.colPools[i];

            balance = loan.collaterals[poolId].balance.toUnderlingAmount(
                pools[poolId].getUpdatedDepositInterestIndex()
            );
            priceFeed = oracleManager.processPriceFeed(poolId);
            effectiveValue += MathUtils.calcCollateralAssetLoanValue(
                balance,
                priceFeed.price,
                priceFeed.decimals,
                loanPools[poolId].collateralFactor
            );
        }
        loanLiquidity.effectiveCollateralValue = effectiveValue;

        // calc effective borrow value
        effectiveValue = 0;
        poolsLength = loan.borPools.length;
        for (uint8 i = 0; i < poolsLength; i++) {
            poolId = loan.borPools[i];

            LoanManagerState.UserLoanBorrow memory loanBorrow = loan.borrows[poolId];
            balance = loanBorrow.lastStableUpdateTimestamp > 0
                ? calcStableBorrowBalance(
                    loanBorrow.balance,
                    loanBorrow.lastInterestIndex,
                    loanBorrow.stableInterestRate,
                    block.timestamp - loanBorrow.lastStableUpdateTimestamp
                )
                : calcVariableBorrowBalance(
                    loanBorrow.balance,
                    loanBorrow.lastInterestIndex,
                    pools[poolId].getUpdatedVariableBorrowInterestIndex()
                );
            priceFeed = oracleManager.processPriceFeed(poolId);
            effectiveValue += MathUtils.calcBorrowAssetLoanValue(
                balance,
                priceFeed.price,
                priceFeed.decimals,
                loanPools[poolId].borrowFactor
            );
        }
        loanLiquidity.effectiveBorrowValue = effectiveValue;
    }

    /// @dev Check if a loan is over collateralized
    /// @param loan The loan to check if it is over collateralized
    /// @param pools The mapping of the pool ID to the pool contract.
    /// @param loanPools The mapping of the pool ID to the loan pool data.
    /// @param oracleManager The OracleManager contract.
    /// @return True if the loan is over collateralized, false otherwise.
    function isLoanOverCollateralized(
        LoanManagerState.UserLoan storage loan,
        mapping(uint8 poolId => IHubPool) storage pools,
        mapping(uint8 poolId => LoanManagerState.LoanPool) storage loanPools,
        IOracleManager oracleManager
    ) internal view returns (bool) {
        DataTypes.LoanLiquidityParams memory loanLiquidity = getLoanLiquidity(loan, pools, loanPools, oracleManager);
        return loanLiquidity.effectiveCollateralValue >= loanLiquidity.effectiveBorrowValue;
    }

    /// @dev Update the interests data and balance of the borrow.
    /// @param loanBorrow The loan borrow to update.
    /// @param params The parameters to update the loan borrow with.
    function updateLoanBorrowInterests(
        LoanManagerState.UserLoanBorrow storage loanBorrow,
        DataTypes.UpdateUserLoanBorrowParams memory params
    ) internal {
        if (loanBorrow.lastStableUpdateTimestamp > 0) {
            uint256 oldInterestIndex = loanBorrow.lastInterestIndex;
            uint256 oldStableInterestRate = loanBorrow.stableInterestRate;
            loanBorrow.lastInterestIndex = MathUtils.calcBorrowInterestIndex(
                oldStableInterestRate,
                oldInterestIndex,
                block.timestamp - loanBorrow.lastStableUpdateTimestamp
            );
            loanBorrow.lastStableUpdateTimestamp = block.timestamp;

            // update balance with interest
            loanBorrow.balance = MathUtils.calcBorrowBalance(
                loanBorrow.balance,
                loanBorrow.lastInterestIndex,
                oldInterestIndex
            );

            // calc and update loan stable rate, calc before update balance with amount
            if (params.isStableInterestRateToUpdate)
                loanBorrow.stableInterestRate = MathUtils.calcStableInterestRate(
                    loanBorrow.balance,
                    params.amount,
                    oldStableInterestRate,
                    params.poolStableInterestRate
                );
        } else {
            loanBorrow.balance = MathUtils.calcBorrowBalance(
                loanBorrow.balance,
                params.poolVariableInterestIndex,
                loanBorrow.lastInterestIndex
            );
            loanBorrow.lastInterestIndex = params.poolVariableInterestIndex;
        }
    }

    function clearBorrow(LoanManagerState.UserLoan storage loan, uint8 poolId) private {
        uint256 borPoolsLength = loan.borPools.length;
        for (uint8 i = 0; i < borPoolsLength; ) {
            if (loan.borPools[i] == poolId) {
                loan.borPools[i] = loan.borPools[borPoolsLength - 1];
                loan.borPools.pop();
                delete loan.borrows[poolId];
                break;
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @dev Setup the interests data of the new borrow.
    /// @param loanBorrow The loan borrow to initialize.
    /// @param params The parameters to initialize the loan borrow with.
    function initLoanBorrowInterests(
        LoanManagerState.UserLoanBorrow storage loanBorrow,
        DataTypes.UpdateUserLoanBorrowParams memory params,
        bool isStable
    ) private {
        if (isStable) {
            loanBorrow.lastInterestIndex = MathUtils.ONE_18_DP;
            loanBorrow.stableInterestRate = params.poolStableInterestRate;
            loanBorrow.lastStableUpdateTimestamp = block.timestamp;
        } else {
            loanBorrow.lastInterestIndex = params.poolVariableInterestIndex;
            loanBorrow.stableInterestRate = 0;
            loanBorrow.lastStableUpdateTimestamp = 0;
        }
    }

    function calcVariableBorrowBalance(
        uint256 balance,
        uint256 loanInterestIndex,
        uint256 poolInterestIndex
    ) private pure returns (uint256) {
        return balance.calcBorrowBalance(poolInterestIndex, loanInterestIndex);
    }

    function calcStableBorrowBalance(
        uint256 balance,
        uint256 loanInterestIndex,
        uint256 loanInterestRate,
        uint256 stableBorrowChangeDelta
    ) private pure returns (uint256) {
        uint256 stableBorrowInterestIndex = MathUtils.calcBorrowInterestIndex(
            loanInterestRate,
            loanInterestIndex,
            stableBorrowChangeDelta
        );
        return balance.calcBorrowBalance(stableBorrowInterestIndex, loanInterestIndex);
    }
}
