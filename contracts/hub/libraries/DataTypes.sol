// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "../interfaces/IOracleManager.sol";

library DataTypes {
    struct LoanLiquidityParams {
        uint256 effectiveCollateralValue;
        uint256 effectiveBorrowValue;
    }

    struct DepositPoolParams {
        uint256 fAmount;
        uint256 depositInterestIndex;
        DataTypes.PriceFeed priceFeed;
    }

    struct WithdrawPoolParams {
        uint256 underlingAmount;
        uint256 fAmount;
    }

    struct RepayWithCollateralPoolParams {
        uint256 fAmount;
    }

    struct RebalanceDownPoolParams {
        uint256 variableInterestIndex;
        uint256 stableInterestRate;
        uint256 threshold;
    }

    struct BorrowPoolParams {
        uint256 variableInterestIndex;
        uint256 stableInterestRate;
    }

    struct ExecuteDepositParams {
        bytes32 loanId;
        uint8 poolId;
        uint256 amount;
    }

    struct ExecuteDepositFTokenParams {
        bytes32 loanId;
        uint8 poolId;
        address sender;
        uint256 fAmount;
    }

    struct ExecuteWithdrawParams {
        bytes32 loanId;
        uint8 poolId;
        uint256 amount;
        bool isFAmount;
        bool checkOverCollateralization;
    }

    struct ExecuteWithdrawFTokenParams {
        bytes32 loanId;
        uint8 poolId;
        address recipient;
        uint256 fAmount;
    }

    struct ExecuteBorrowParams {
        bytes32 loanId;
        uint8 poolId;
        uint256 amount;
        uint256 maxStableRate;
    }

    struct ExecuteRepayParams {
        bytes32 loanId;
        uint8 poolId;
        uint256 amount;
        uint256 maxOverRepayment;
    }

    struct ExecuteRepayWithCollateralParams {
        bytes32 loanId;
        uint8 poolId;
        uint256 amount;
    }

    struct RepayExecutedParams {
        uint256 amountPaid;
        uint256 interestPaid;
        uint256 excessPaid;
    }

    struct LiquidationAmountParams {
        uint256 repayBorrowAmount;
        uint256 repayBorrowToCollateralFAmount;
        uint256 seizeCollateralFAmount;
    }

    struct ExecuteLiquidationParams {
        bytes32 violatorLoanId;
        bytes32 liquidatorLoanId;
        bytes32 liquidatorAccountId;
        uint8 colPoolId;
        uint8 borPoolId;
        uint256 maxRepayAmount;
        uint256 minSeizedAmount;
        IOracleManager oracleManager;
    }

    struct LiquidationLoansParams {
        bytes32 liquidatorLoanId;
        bytes32 violatorLoanId;
        uint8 collateralPoolId;
        uint8 borrowPoolId;
    }

    struct ViolatorParams {
        uint256 effectiveBorrowValue;
        uint256 effectiveCollateralValue;
    }

    struct LiquidationBorrowTransfer {
        uint256 amountRepaid;
        uint256 balanceRepaid;
        bool isStable;
    }

    struct CollateralSeizedParams {
        uint256 totalAmount;
        uint256 liquidatorAmount;
        uint256 reserveAmount;
    }

    struct ExecuteSwitchBorrowTypeParams {
        bytes32 loanId;
        uint8 poolId;
        uint256 maxStableRate;
    }

    struct ExecuteRebalanceParams {
        bytes32 loanId;
        uint8 poolId;
    }

    struct UpdateUserLoanBorrowParams {
        uint8 poolId;
        uint256 amount;
        uint256 poolVariableInterestIndex;
        uint256 poolStableInterestRate;
        bool isStableInterestRateToUpdate;
    }

    struct UpdateUserLoanBorrowTypeParams {
        uint8 poolId;
        bool switchingToStable;
        uint256 poolVariableInterestIndex;
        uint256 poolStableInterestRate;
    }

    struct OracleNode {
        bytes32 nodeId;
        uint8 decimals;
    }

    struct PriceFeed {
        uint256 price;
        uint8 decimals;
    }
}
