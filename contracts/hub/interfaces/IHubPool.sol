// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../bridge/interfaces/IBridgeRouter.sol";
import "../../bridge/libraries/Messages.sol";
import "../libraries/DataTypes.sol";

interface IHubPool is IERC20 {
    error UnmatchedChainSpoke(uint16 chainId, bytes32 expected, bytes32 actual);

    function HUB_ROLE() external view returns (bytes32);
    function LOAN_MANAGER_ROLE() external view returns (bytes32);

    function getPoolId() external view returns (uint8);
    function getTokenFeeClaimer() external view returns (address);
    function getTokenFeeRecipient() external view returns (bytes32);

    function clearTokenFees() external returns (uint256);
    function verifyReceiveToken(uint16 chainId, bytes32 source) external view;
    function getSendTokenMessage(
        IBridgeRouter bridgeRouter,
        uint16 adapterId,
        uint256 gasLimit,
        bytes32 accountId,
        uint16 chainId,
        uint256 amount,
        bytes32 recipient
    ) external returns (Messages.MessageToSend memory);

    function getUpdatedDepositInterestIndex() external view returns (uint256);
    function getUpdatedVariableBorrowInterestIndex() external view returns (uint256);

    function updateInterestIndexes() external;
    function updatePoolWithDeposit(
        uint256 amount
    ) external returns (DataTypes.DepositPoolParams memory depositPoolParams);
    function preparePoolForWithdraw(
        uint256 amount,
        bool isFAmount
    ) external returns (DataTypes.WithdrawPoolParams memory withdrawPoolParams);
    function updatePoolWithWithdraw(uint256 underlyingAmount) external;
    function preparePoolForWithdrawFToken() external;
    function preparePoolForBorrow(
        uint256 amount,
        uint256 maxStableRate
    ) external returns (DataTypes.BorrowPoolParams memory borrowPoolParams);
    function updatePoolWithBorrow(uint256 amount, bool isStable) external;
    function preparePoolForRepay() external returns (DataTypes.BorrowPoolParams memory borrowPoolParams);
    function updatePoolWithRepay(
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 loanStableRate,
        uint256 excessAmount
    ) external;
    function updatePoolWithRepayWithCollateral(
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 loanStableRate
    ) external returns (DataTypes.RepayWithCollateralPoolParams memory repayWithCollateralPoolParams);
    function updatePoolWithLiquidation() external;
    function preparePoolForSwitchBorrowType(
        uint256 amount,
        uint256 maxStableRate
    ) external returns (DataTypes.BorrowPoolParams memory borrowPoolParams);
    function updatePoolWithSwitchBorrowType(
        uint256 loanBorrowAmount,
        bool switchingToStable,
        uint256 oldLoanBorrowStableRate
    ) external;
    function preparePoolForRebalanceUp() external returns (DataTypes.BorrowPoolParams memory borrowPoolParams);
    function updatePoolWithRebalanceUp(uint256 amount, uint256 oldLoanStableInterestRate) external;
    function preparePoolForRebalanceDown()
        external
        returns (DataTypes.RebalanceDownPoolParams memory rebalanceDownPoolParams);
    function updatePoolWithRebalanceDown(uint256 amount, uint256 oldLoanStableInterestRate) external;

    function mintFTokenForFeeRecipient(uint256 amount) external;
    function mintFToken(address recipient, uint256 amount) external;
    function burnFToken(address sender, uint256 amount) external;
}
