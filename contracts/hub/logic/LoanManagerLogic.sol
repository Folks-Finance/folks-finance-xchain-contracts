// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IHubPool.sol";
import "../libraries/DataTypes.sol";
import "../libraries/MathUtils.sol";
import "../LoanManagerState.sol";
import "../logic/LoanPoolLogic.sol";
import "../logic/UserLoanLogic.sol";
import "../logic/LiquidationLogic.sol";
import "../logic/RewardLogic.sol";

library LoanManagerLogic {
    using MathUtils for uint256;
    using LoanPoolLogic for LoanManagerState.LoanPool;
    using RewardLogic for LoanManagerState.LoanPool;
    using UserLoanLogic for LoanManagerState.UserLoan;
    using RewardLogic for LoanManagerState.UserPoolRewards;
    using LiquidationLogic for DataTypes.LiquidationLoansParams;

    error CollateralCapReached(uint8 poolId);
    error UnderCollateralizedLoan(bytes32 loanId);
    error BorrowCapReached(uint16 loanTypeId, uint8 poolId);
    error NoCollateralInLoanForPool(bytes32 loanId, uint8 poolId);
    error NoBorrowInLoanForPool(bytes32 loanId, uint8 poolId);
    error NoStableBorrowInLoanForPool(bytes32 loanId, uint8 poolId);
    error NoVariableBorrowInLoanForPool(bytes32 loanId, uint8 poolId);
    error ExcessRepaymentExceeded(uint256 maxOverRepayment, uint256 excessPaid);
    error RebalanceUpToLowerRate();
    error RebalanceDownThresholdNotReached();

    event Deposit(bytes32 loanId, uint8 poolId, uint256 amount, uint256 fAmount);
    event DepositFToken(bytes32 loanId, uint8 poolId, uint256 fAmount);
    event Withdraw(bytes32 loanId, uint8 poolId, uint256 amount, uint256 fAmount);
    event WithdrawFToken(bytes32 loanId, uint8 poolId, uint256 fAmount);
    event Borrow(bytes32 loanId, uint8 poolId, uint256 amount, bool isStableBorrow, uint256 stableInterestRate);
    event Repay(bytes32 loanId, uint8 poolId, uint256 principalPaid, uint256 interestPaid, uint256 excessPaid);
    event RepayWithCollateral(
        bytes32 loanId,
        uint8 poolId,
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 fAmount
    );
    event Liquidate(
        bytes32 violatorLoanId,
        bytes32 liquidatorLoanId,
        uint8 colPoolId,
        uint8 borPoolId,
        uint256 repayBorrowAmount,
        uint256 liquidatorCollateralFAmount,
        uint256 reserveCollateralFAmount
    );
    event SwitchBorrowType(bytes32 loanId, uint8 poolId);
    event RebalanceUp(bytes32 loanId, uint8 poolId, uint256 stableInterestRate);
    event RebalanceDown(bytes32 loanId, uint8 poolId, uint256 stableInterestRate);

    /// @notice Implements the deposit function i.e. the user deposits collateral into the pool,
    /// increasing the collateral balance of its loan.
    /// @dev Emits a Deposit event.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @param loanTypes The mapping of the type ID to loan types data including a mapping with the pools' details.
    /// @param pools The mapping of pool IDs to pool contracts.
    /// @param params The deposit parameters including the loan ID, pool ID and amount.
    function executeDeposit(
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 loanTypeId => LoanManagerState.LoanType) storage loanTypes,
        mapping(uint8 => IHubPool) storage pools,
        mapping(bytes32 accountId => mapping(uint8 poolId => LoanManagerState.UserPoolRewards)) storage userPoolRewards,
        DataTypes.ExecuteDepositParams memory params
    ) external {
        LoanManagerState.UserLoan storage userLoan = userLoans[params.loanId];
        LoanManagerState.LoanType storage loanType = loanTypes[userLoan.loanTypeId];
        LoanManagerState.LoanPool storage loanPool = loanType.pools[params.poolId];

        // check the loan type and pool are available
        // user loan active iff loan type created so no need to check this
        if (loanType.isDeprecated) revert LoanManagerState.LoanTypeDeprecated(userLoan.loanTypeId);
        if (!loanPool.isAdded) revert LoanManagerState.LoanPoolUnknown(userLoan.loanTypeId, params.poolId);
        if (loanPool.isDeprecated) revert LoanManagerState.LoanPoolDeprecated(userLoan.loanTypeId, params.poolId);

        // update the pool
        IHubPool pool = pools[params.poolId];
        DataTypes.DepositPoolParams memory depositPoolParams = pool.updatePoolWithDeposit(params.amount);

        // check the collateral cap will not be exceeded considering the new deposit
        if (
            loanPool.isCollateralCapReached(
                depositPoolParams.priceFeed,
                depositPoolParams.fAmount,
                depositPoolParams.depositInterestIndex
            )
        ) revert CollateralCapReached(params.poolId);

        RewardLogic.updateRewardIndexes(loanPool, params.poolId);
        RewardLogic.updateUserCollateralReward(userPoolRewards, userLoan, loanPool, params.poolId);

        // increase the user loan collateral and global collateral used for loan type
        userLoan.increaseCollateral(params.poolId, depositPoolParams.fAmount);
        loanPool.increaseCollateral(depositPoolParams.fAmount);

        emit Deposit(params.loanId, params.poolId, params.amount, depositPoolParams.fAmount);
    }

    /// @notice Implements the deposit fToken function i.e. the user deposits fToken into the pool,
    /// increasing the collateral balance of its loan.
    /// @dev Emits a DepositFToken event.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @param loanTypes The mapping of the type ID to loan types data including a mapping with the pools' details.
    /// @param pools The mapping of pool IDs to pool contracts.
    /// @param oracleManager The OracleManager contract.
    /// @param params The deposit fToken parameters including the loan ID, pool ID and fAmount.
    function executeDepositFToken(
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 loanTypeId => LoanManagerState.LoanType) storage loanTypes,
        mapping(uint8 => IHubPool) storage pools,
        mapping(bytes32 accountId => mapping(uint8 poolId => LoanManagerState.UserPoolRewards)) storage userPoolRewards,
        IOracleManager oracleManager,
        DataTypes.ExecuteDepositFTokenParams memory params
    ) external {
        LoanManagerState.UserLoan storage userLoan = userLoans[params.loanId];
        LoanManagerState.LoanType storage loanType = loanTypes[userLoan.loanTypeId];
        LoanManagerState.LoanPool storage loanPool = loanType.pools[params.poolId];

        // check the loan type and pool are available
        // user loan active iff loan type created so no need to check this
        if (loanType.isDeprecated) revert LoanManagerState.LoanTypeDeprecated(userLoan.loanTypeId);
        if (!loanPool.isAdded) revert LoanManagerState.LoanPoolUnknown(userLoan.loanTypeId, params.poolId);
        if (loanPool.isDeprecated) revert LoanManagerState.LoanPoolDeprecated(userLoan.loanTypeId, params.poolId);

        // no need to update the pool as underlying token was already deposited

        // check the collateral cap will not be exceeded considering the new deposit
        IHubPool pool = pools[params.poolId];
        DataTypes.PriceFeed memory priceFeed = oracleManager.processPriceFeed(params.poolId);
        if (loanPool.isCollateralCapReached(priceFeed, params.fAmount, pool.getUpdatedDepositInterestIndex()))
            revert CollateralCapReached(params.poolId);

        RewardLogic.updateRewardIndexes(loanPool, params.poolId);
        RewardLogic.updateUserCollateralReward(userPoolRewards, userLoan, loanPool, params.poolId);

        // increase the user loan collateral and global collateral used for loan type
        userLoan.increaseCollateral(params.poolId, params.fAmount);
        loanPool.increaseCollateral(params.fAmount);

        // burn f token from user
        pools[params.poolId].burnFToken(params.sender, params.fAmount);

        emit DepositFToken(params.loanId, params.poolId, params.fAmount);
    }

    /// @notice Implements the withdraw function i.e. the user withdraws collateral from the pool,
    /// decreasing the collateral balance of its loan, will receive the underlying amount.
    /// @dev Emits a Withdraw event.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @param loanTypes The mapping of the type ID to loan types data including a mapping with the pools' details.
    /// @param pools The mapping of pool IDs to pool contracts.
    /// @param oracleManager The OracleManager contract.
    /// @param params The withdraw parameters including the loan ID, pool ID, amount and isFAmount.
    function executeWithdraw(
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 loanTypeId => LoanManagerState.LoanType) storage loanTypes,
        mapping(uint8 => IHubPool) storage pools,
        mapping(bytes32 accountId => mapping(uint8 poolId => LoanManagerState.UserPoolRewards)) storage userPoolRewards,
        IOracleManager oracleManager,
        DataTypes.ExecuteWithdrawParams memory params
    ) public returns (uint256) {
        LoanManagerState.UserLoan storage userLoan = userLoans[params.loanId];
        LoanManagerState.LoanPool storage loanPool = loanTypes[userLoan.loanTypeId].pools[params.poolId];

        // user cannot withdraw collateral which they don't have
        // collateral present iff loan type created and pool added so no need to check this
        if (!userLoan.hasCollateralIn(params.poolId)) revert NoCollateralInLoanForPool(params.loanId, params.poolId);

        // pool pre-checks and update interest indexes
        IHubPool pool = pools[params.poolId];
        DataTypes.WithdrawPoolParams memory withdrawPoolParams = pool.preparePoolForWithdraw(
            params.amount,
            params.isFAmount
        );

        RewardLogic.updateRewardIndexes(loanPool, params.poolId);
        RewardLogic.updateUserCollateralReward(userPoolRewards, userLoan, loanPool, params.poolId);

        // decrease the user loan collateral and global collateral used for loan type
        userLoan.decreaseCollateral(params.poolId, withdrawPoolParams.fAmount);
        loanPool.decreaseCollateral(withdrawPoolParams.fAmount);

        // update the pool
        pool.updatePoolWithWithdraw(withdrawPoolParams.underlingAmount);

        // if applicable, check loan is over-collateralised after the withdrawal
        if (params.checkOverCollateralization)
            if (!userLoan.isLoanOverCollateralized(pools, loanTypes[userLoan.loanTypeId].pools, oracleManager))
                revert UnderCollateralizedLoan(params.loanId);

        emit Withdraw(params.loanId, params.poolId, withdrawPoolParams.underlingAmount, withdrawPoolParams.fAmount);

        return withdrawPoolParams.underlingAmount;
    }

    /// @notice Implements the withdraw fToken function i.e. the user withdraws fToken from the pool,
    /// decreasing the collateral balance of its loan, will receive the fToken amount.
    /// @dev Emits a WithdrawFToken event.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @param loanTypes The mapping of the type ID to loan types data including a mapping with the pools' details.
    /// @param pools The mapping of pool IDs to pool contracts.
    /// @param oracleManager The OracleManager contract.
    /// @param params The withdraw fToken parameters including the loan ID, pool ID and fAmount.
    function executeWithdrawFToken(
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 loanTypeId => LoanManagerState.LoanType) storage loanTypes,
        mapping(uint8 => IHubPool) storage pools,
        mapping(bytes32 accountId => mapping(uint8 poolId => LoanManagerState.UserPoolRewards)) storage userPoolRewards,
        IOracleManager oracleManager,
        DataTypes.ExecuteWithdrawFTokenParams memory params
    ) external {
        LoanManagerState.UserLoan storage userLoan = userLoans[params.loanId];
        LoanManagerState.LoanPool storage loanPool = loanTypes[userLoan.loanTypeId].pools[params.poolId];

        // user cannot withdraw collateral which they don't have
        // collateral present iff loan type created and pool added so no need to check this
        if (!userLoan.hasCollateralIn(params.poolId)) revert NoCollateralInLoanForPool(params.loanId, params.poolId);

        // no need to update the pool as underlying token was already deposited
        pools[params.poolId].preparePoolForWithdrawFToken();

        RewardLogic.updateRewardIndexes(loanPool, params.poolId);
        RewardLogic.updateUserCollateralReward(userPoolRewards, userLoan, loanPool, params.poolId);

        // decrease the user loan collateral and global collateral used for loan type
        userLoan.decreaseCollateral(params.poolId, params.fAmount);
        loanPool.decreaseCollateral(params.fAmount);

        // check loan is over-collateralised after the withdrawal
        if (!userLoan.isLoanOverCollateralized(pools, loanTypes[userLoan.loanTypeId].pools, oracleManager))
            revert UnderCollateralizedLoan(params.loanId);

        // mint f token for user
        pools[params.poolId].mintFToken(params.recipient, params.fAmount);

        emit WithdrawFToken(params.loanId, params.poolId, params.fAmount);
    }

    /// @notice Implements the borrow function i.e. the user borrows from the pool based on the collateral provided.
    /// @dev Emits a Borrow event.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @param loanTypes The mapping of the type ID to loan types data including a mapping with the pools' details.
    /// @param pools The mapping of pool IDs to pool contracts.
    /// @param oracleManager The OracleManager contract.
    /// @param params The borrow parameters including the loan ID, pool ID, amount and maxStableRate.
    function executeBorrow(
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 loanTypeId => LoanManagerState.LoanType) storage loanTypes,
        mapping(uint8 => IHubPool) storage pools,
        mapping(bytes32 accountId => mapping(uint8 poolId => LoanManagerState.UserPoolRewards)) storage userPoolRewards,
        IOracleManager oracleManager,
        DataTypes.ExecuteBorrowParams memory params
    ) external {
        LoanManagerState.UserLoan storage userLoan = userLoans[params.loanId];
        LoanManagerState.LoanType storage loanType = loanTypes[userLoan.loanTypeId];
        LoanManagerState.LoanPool storage loanPool = loanType.pools[params.poolId];

        // check the loan type and pool are available
        // user loan active iff loan type created so no need to check this
        if (loanType.isDeprecated) revert LoanManagerState.LoanTypeDeprecated(userLoan.loanTypeId);
        if (!loanPool.isAdded) revert LoanManagerState.LoanPoolUnknown(userLoan.loanTypeId, params.poolId);
        if (loanPool.isDeprecated) revert LoanManagerState.LoanPoolDeprecated(userLoan.loanTypeId, params.poolId);

        // check the borrow cap will not be exceeded considering the new borrow
        DataTypes.PriceFeed memory priceFeed = oracleManager.processPriceFeed(params.poolId);
        if (loanPool.isBorrowCapReached(priceFeed, params.amount))
            revert BorrowCapReached(userLoan.loanTypeId, params.poolId);

        // pool pre-checks and update interest indexes
        IHubPool pool = pools[params.poolId];
        DataTypes.BorrowPoolParams memory borrowPoolParams = pool.preparePoolForBorrow(
            params.amount,
            params.maxStableRate
        );

        RewardLogic.updateRewardIndexes(loanPool, params.poolId);
        RewardLogic.updateUserBorrowReward(userPoolRewards, userLoan, loanPool, params.poolId);

        // increase the user loan borrow and global borrow used for loan type
        bool isStableBorrow = params.maxStableRate > 0;
        userLoan.increaseBorrow(
            DataTypes.UpdateUserLoanBorrowParams({
                poolId: params.poolId,
                amount: params.amount,
                poolVariableInterestIndex: borrowPoolParams.variableInterestIndex,
                poolStableInterestRate: borrowPoolParams.stableInterestRate,
                isStableInterestRateToUpdate: true
            }),
            isStableBorrow
        );
        loanPool.increaseBorrow(params.amount);

        // update the pool
        pool.updatePoolWithBorrow(params.amount, isStableBorrow);

        // check loan is over-collateralised after the borrow
        if (!userLoan.isLoanOverCollateralized(pools, loanType.pools, oracleManager))
            revert UnderCollateralizedLoan(params.loanId);

        emit Borrow(params.loanId, params.poolId, params.amount, isStableBorrow, borrowPoolParams.stableInterestRate);
    }

    /// @notice Implements the repay function i.e. the user repays the borrow based.
    /// @dev Emits a Repay event.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @param loanTypes The mapping of the type ID to loan types data including a mapping with the pools' details.
    /// @param pools The mapping of pool IDs to pool contracts.
    /// @param params The repay parameters including the loan ID, pool ID, amount, isStableBorrow and maxOverRepayment.
    function executeRepay(
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 loanTypeId => LoanManagerState.LoanType) storage loanTypes,
        mapping(uint8 => IHubPool) storage pools,
        mapping(bytes32 accountId => mapping(uint8 poolId => LoanManagerState.UserPoolRewards)) storage userPoolRewards,
        DataTypes.ExecuteRepayParams memory params
    ) public {
        LoanManagerState.UserLoan storage userLoan = userLoans[params.loanId];
        LoanManagerState.LoanPool storage loanPool = loanTypes[userLoan.loanTypeId].pools[params.poolId];

        // user cannot repay borrow which they don't have
        // borrow present iff loan type created and pool added so no need to check this
        if (!userLoan.hasBorrowIn(params.poolId)) revert NoBorrowInLoanForPool(params.loanId, params.poolId);

        // pool pre-checks and update interest indexes
        IHubPool pool = pools[params.poolId];
        DataTypes.BorrowPoolParams memory borrowPoolParams = pool.preparePoolForRepay();

        // decrease the user loan borrow and global borrow used for loan type
        (uint256 principalPaid, uint256 interestPaid, uint256 excessPaid, uint256 loanStableRate) = userLoan
            .decreaseBorrow(
                DataTypes.UpdateUserLoanBorrowParams({
                    poolId: params.poolId,
                    amount: params.amount,
                    poolVariableInterestIndex: borrowPoolParams.variableInterestIndex,
                    poolStableInterestRate: borrowPoolParams.stableInterestRate,
                    isStableInterestRateToUpdate: false
                })
            );
        if (excessPaid > params.maxOverRepayment) revert ExcessRepaymentExceeded(params.maxOverRepayment, excessPaid);

        RewardLogic.updateRewardIndexes(loanPool, params.poolId);
        RewardLogic.updateUserBorrowRewardWithRepayment(
            userPoolRewards,
            userLoan,
            loanPool,
            params.poolId,
            principalPaid,
            interestPaid
        );

        loanPool.decreaseBorrow(principalPaid);

        // update the pool
        pool.updatePoolWithRepay(principalPaid, interestPaid, loanStableRate, excessPaid);

        emit Repay(params.loanId, params.poolId, principalPaid, interestPaid, excessPaid);
    }

    /// @notice Implements the repay with collateral function i.e. the user repays the borrowed balance with its collateral.
    /// @dev Emits a RepayWithCollateral event.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @param loanTypes The mapping of the type ID to loan types data including a mapping with the pools' details.
    /// @param pools The mapping of pool IDs to pool contracts.
    /// @param params The repay with collateral parameters including the loan ID, pool ID, amount and isStableBorrow.
    function executeRepayWithCollateral(
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 loanTypeId => LoanManagerState.LoanType) storage loanTypes,
        mapping(uint8 => IHubPool) storage pools,
        mapping(bytes32 accountId => mapping(uint8 poolId => LoanManagerState.UserPoolRewards)) storage userPoolRewards,
        DataTypes.ExecuteRepayWithCollateralParams memory params
    ) external {
        LoanManagerState.UserLoan storage userLoan = userLoans[params.loanId];
        LoanManagerState.LoanPool storage loanPool = loanTypes[userLoan.loanTypeId].pools[params.poolId];

        // user cannot repay borrow or withdraw collateral which they don't have
        // borrow/collateral present iff loan type created and pool added so no need to check this
        if (!userLoan.hasBorrowIn(params.poolId)) revert NoBorrowInLoanForPool(params.loanId, params.poolId);
        if (!userLoan.hasCollateralIn(params.poolId)) revert NoCollateralInLoanForPool(params.loanId, params.poolId);

        // pool pre-checks and update interest indexes
        IHubPool pool = pools[params.poolId];
        DataTypes.BorrowPoolParams memory borrowPoolParams = pool.preparePoolForRepay();

        // decrease the user loan borrow and global borrow used for loan type
        (uint256 principalPaid, uint256 interestPaid, , uint256 loanStableRate) = userLoan.decreaseBorrow(
            DataTypes.UpdateUserLoanBorrowParams({
                poolId: params.poolId,
                amount: params.amount,
                poolVariableInterestIndex: borrowPoolParams.variableInterestIndex,
                poolStableInterestRate: borrowPoolParams.stableInterestRate,
                isStableInterestRateToUpdate: false
            })
        );

        RewardLogic.updateRewardIndexes(loanPool, params.poolId);
        RewardLogic.updateUserCollateralReward(userPoolRewards, userLoan, loanPool, params.poolId);
        RewardLogic.updateUserBorrowRewardWithRepayment(
            userPoolRewards,
            userLoan,
            loanPool,
            params.poolId,
            principalPaid,
            interestPaid
        );

        loanPool.decreaseBorrow(principalPaid);

        // update the pool
        DataTypes.RepayWithCollateralPoolParams memory repayWithCollateralPoolParams = pool
            .updatePoolWithRepayWithCollateral(principalPaid, interestPaid, loanStableRate);

        // decrease the user loan collateral and global collateral used for loan type
        userLoan.decreaseCollateral(params.poolId, repayWithCollateralPoolParams.fAmount);
        loanPool.decreaseCollateral(repayWithCollateralPoolParams.fAmount);

        emit RepayWithCollateral(
            params.loanId,
            params.poolId,
            principalPaid,
            interestPaid,
            repayWithCollateralPoolParams.fAmount
        );
    }

    /// @notice Implements the liquidate function.
    /// @dev Emits a Liquidate event.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @param loanTypes The mapping of the type ID to loan types data including a mapping with the pools' details.
    /// @param pools The mapping of pool IDs to pool contracts.
    /// @param params The liquidation parameters including the liquidator loan ID, violator loan ID, collateral pool ID and borrow pool ID.
    function executeLiquidate(
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 loanTypeId => LoanManagerState.LoanType) storage loanTypes,
        mapping(uint8 => IHubPool) storage pools,
        mapping(bytes32 accountId => mapping(uint8 poolId => LoanManagerState.UserPoolRewards)) storage userPoolRewards,
        DataTypes.ExecuteLiquidationParams memory params
    ) external {
        DataTypes.LiquidationLoansParams memory loansParams = DataTypes.LiquidationLoansParams({
            liquidatorLoanId: params.liquidatorLoanId,
            violatorLoanId: params.violatorLoanId,
            collateralPoolId: params.colPoolId,
            borrowPoolId: params.borPoolId
        });

        // check violator loan is under-collateralized and calc max repay value
        uint256 maxRepayBorrowValue;
        {
            DataTypes.LoanLiquidityParams memory violatorLiquidity = loansParams.prepareLiquidation(
                userLoans,
                loanTypes,
                pools,
                params.oracleManager
            );
            maxRepayBorrowValue = loansParams.getMaxRepayBorrowValue(userLoans, loanTypes, violatorLiquidity);
        }

        // calc actual repay and seize amounts considering the user loan and max specified
        DataTypes.LiquidationAmountParams memory liquidationAmounts = loansParams.calcLiquidationAmounts(
            userLoans,
            loanTypes,
            pools[loansParams.collateralPoolId],
            params.oracleManager,
            maxRepayBorrowValue,
            params.maxRepayAmount
        );

        loansParams.updateLiquidationRewards(userLoans, loanTypes, userPoolRewards);

        DataTypes.LiquidationBorrowTransfer memory liquidationBorrowTransfer;
        {
            // pool pre-checks and update interest indexes
            DataTypes.BorrowPoolParams memory borrowPoolParams = pools[params.borPoolId].preparePoolForRepay();

            // transfer borrow from violator to liquidator
            liquidationBorrowTransfer = loansParams.updateLiquidationBorrows(
                borrowPoolParams,
                liquidationAmounts.repayBorrowAmount,
                userLoans
            );
        }

        // transfer collateral from violator to liquidator
        DataTypes.CollateralSeizedParams memory collateralSeized = loansParams.updateLiquidationCollaterals(
            liquidationAmounts.seizeCollateralFAmount,
            liquidationAmounts.repayBorrowToCollateralFAmount,
            params.minSeizedAmount,
            userLoans,
            loanTypes
        );

        // update the pool
        pools[params.borPoolId].updatePoolWithLiquidation();

        // check liquidator loan in over-collateralized after taking over part of the violator loan
        loansParams.checkLiquidatorLoan(userLoans, loanTypes, pools, params.oracleManager);

        // mint f token for fee recipient
        pools[params.colPoolId].mintFTokenForFeeRecipient(collateralSeized.reserveAmount);

        emit Liquidate(
            params.violatorLoanId,
            params.liquidatorLoanId,
            params.colPoolId,
            params.borPoolId,
            liquidationAmounts.repayBorrowAmount,
            collateralSeized.liquidatorAmount,
            collateralSeized.reserveAmount
        );
    }

    /// @notice Implements switch borrow type function so from stable to variable and vice versa.
    /// @dev Emits a SwitchBorrowType event.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @param pools The mapping of pool IDs to pool contracts.
    /// @param params The switch borrow type parameters including the loan ID, pool ID and maxStableRate.
    function executeSwitchBorrowType(
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint16 loanTypeId => LoanManagerState.LoanType) storage loanTypes,
        mapping(uint8 => IHubPool) storage pools,
        IOracleManager oracleManager,
        DataTypes.ExecuteSwitchBorrowTypeParams memory params
    ) external {
        LoanManagerState.UserLoan storage userLoan = userLoans[params.loanId];
        LoanManagerState.LoanType storage loanType = loanTypes[userLoan.loanTypeId];

        // user cannot switch borrow type for borrow which they don't have
        // borrow present iff loan type created and pool added so no need to check this
        bool switchingToStable = params.maxStableRate > 0;
        if (switchingToStable) {
            if (!userLoan.hasVariableBorrowIn(params.poolId))
                revert NoVariableBorrowInLoanForPool(params.loanId, params.poolId);
        } else if (!userLoan.hasStableBorrowIn(params.poolId))
            revert NoStableBorrowInLoanForPool(params.loanId, params.poolId);

        // pool pre-checks and update interest indexes
        IHubPool pool = pools[params.poolId];
        uint256 loanBorrowAmount = userLoan.borrows[params.poolId].amount;
        DataTypes.BorrowPoolParams memory borrowPoolParams = pool.preparePoolForSwitchBorrowType(
            loanBorrowAmount,
            params.maxStableRate
        );

        // switch the user loan borrow
        uint256 oldLoanBorrowStableRate = userLoan.switchBorrowType(
            DataTypes.UpdateUserLoanBorrowTypeParams({
                poolId: params.poolId,
                switchingToStable: switchingToStable,
                poolVariableInterestIndex: borrowPoolParams.variableInterestIndex,
                poolStableInterestRate: borrowPoolParams.stableInterestRate
            })
        );

        // update the pool
        pool.updatePoolWithSwitchBorrowType(loanBorrowAmount, switchingToStable, oldLoanBorrowStableRate);

        // check loan is over-collateralised after the switch
        if (!userLoan.isLoanOverCollateralized(pools, loanType.pools, oracleManager))
            revert UnderCollateralizedLoan(params.loanId);

        emit SwitchBorrowType(params.loanId, params.poolId);
    }

    /// @notice Implements the rebalance up function, updating the user stable rate borrow to the current stable rate.
    /// @dev Emits a RebalanceUp event.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @param pools The mapping of pool IDs to pool contracts.
    /// @param params The rebalance up parameters including the loan ID and pool ID.
    function executeRebalanceUp(
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint8 => IHubPool) storage pools,
        DataTypes.ExecuteRebalanceParams memory params
    ) external {
        LoanManagerState.UserLoan storage userLoan = userLoans[params.loanId];

        // user cannot rebalance borrow which they don't have or is not stable
        // borrow present iff loan type created and pool added so no need to check this
        if (!userLoan.hasStableBorrowIn(params.poolId))
            revert NoStableBorrowInLoanForPool(params.loanId, params.poolId);

        // pool pre-checks and update interest indexes
        IHubPool pool = pools[params.poolId];
        DataTypes.BorrowPoolParams memory borrowPoolParams = pool.preparePoolForRebalanceUp();

        // cannot rebalance up to a lower rate
        LoanManagerState.UserLoanBorrow storage loanBorrow = userLoan.borrows[params.poolId];
        uint256 oldLoanStableInterestRate = loanBorrow.stableInterestRate;
        if (borrowPoolParams.stableInterestRate <= oldLoanStableInterestRate) revert RebalanceUpToLowerRate();

        // rebalance the user loan borrow
        UserLoanLogic.updateLoanBorrowInterests(
            loanBorrow,
            DataTypes.UpdateUserLoanBorrowParams({
                poolId: params.poolId,
                amount: 0,
                poolVariableInterestIndex: borrowPoolParams.variableInterestIndex,
                poolStableInterestRate: borrowPoolParams.stableInterestRate,
                isStableInterestRateToUpdate: false
            })
        );

        // update the user borrow stable rate
        loanBorrow.stableInterestRate = borrowPoolParams.stableInterestRate;

        // update the pool
        pool.updatePoolWithRebalanceUp(loanBorrow.amount, oldLoanStableInterestRate);

        emit RebalanceUp(params.loanId, params.poolId, borrowPoolParams.stableInterestRate);
    }

    /// @notice Implements the rebalance down function, updating the user stable rate borrow to the current stable rate.
    /// @dev Emits a RebalanceDown event.
    /// @param userLoans The mapping of the loan ID to user loan including loan type, collateral and borrow details.
    /// @param pools The mapping of pool IDs to pool contracts.
    /// @param params The rebalance down parameters including the loan ID and pool ID.
    function executeRebalanceDown(
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(uint8 => IHubPool) storage pools,
        DataTypes.ExecuteRebalanceParams memory params
    ) external {
        LoanManagerState.UserLoan storage userLoan = userLoans[params.loanId];

        // user cannot rebalance borrow which they don't have or is not stable
        // borrow present iff loan type created and pool added so no need to check this
        if (!userLoan.hasStableBorrowIn(params.poolId))
            revert NoStableBorrowInLoanForPool(params.loanId, params.poolId);

        // pool pre-checks and update interest indexes
        IHubPool pool = pools[params.poolId];
        DataTypes.RebalanceDownPoolParams memory rebalanceDownPoolParams = pool.preparePoolForRebalanceDown();

        // rebalance the user loan borrow
        LoanManagerState.UserLoanBorrow storage loanBorrow = userLoan.borrows[params.poolId];
        uint256 oldLoanStableInterestRate = loanBorrow.stableInterestRate;
        UserLoanLogic.updateLoanBorrowInterests(
            loanBorrow,
            DataTypes.UpdateUserLoanBorrowParams({
                poolId: params.poolId,
                amount: 0,
                poolVariableInterestIndex: rebalanceDownPoolParams.variableInterestIndex,
                poolStableInterestRate: rebalanceDownPoolParams.stableInterestRate,
                isStableInterestRateToUpdate: false
            })
        );

        // check the rebalance down condition
        if (loanBorrow.stableInterestRate < rebalanceDownPoolParams.threshold)
            revert RebalanceDownThresholdNotReached();

        // update the user borrow stable rate
        loanBorrow.stableInterestRate = rebalanceDownPoolParams.stableInterestRate;

        // update the pool
        pool.updatePoolWithRebalanceDown(loanBorrow.amount, oldLoanStableInterestRate);

        emit RebalanceDown(params.loanId, params.poolId, rebalanceDownPoolParams.stableInterestRate);
    }
}
