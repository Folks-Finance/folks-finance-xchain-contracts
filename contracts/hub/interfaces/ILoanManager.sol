// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "./IHubPool.sol";

interface ILoanManager {
    error CollateralCapReached(uint8 poolId);
    error BorrowCapReached(uint8 poolId);

    error NotAccountOwner(bytes32 loanId, bytes32 accountId);
    error UserLoanAlreadyCreated(bytes32 loanId);
    error UnknownUserLoan(bytes32 loanId);
    error LoanNotEmpty(bytes32 loanId);
    error SameLoan(bytes32 loanId);

    event CreateUserLoan(bytes32 loanId, bytes32 indexed accountId, uint16 loanTypeId, bytes32 loanName);
    event DeleteUserLoan(bytes32 loanId, bytes32 indexed accountId);

    function HUB_ROLE() external view returns (bytes32);
    function REBALANCER_ROLE() external view returns (bytes32);

    function getPool(uint8 poolId) external view returns (IHubPool);

    function createUserLoan(
        bytes4 nonce,
        bytes32 accountId,
        uint16 loanTypeId,
        bytes32 loanName
    ) external returns (bytes32 loanId);
    function deleteUserLoan(bytes32 loanId, bytes32 accountId) external;
    function deposit(bytes32 loanId, bytes32 accountId, uint8 poolId, uint256 amount) external;
    function depositFToken(bytes32 loanId, bytes32 accountId, uint8 poolId, address sender, uint256 fAmount) external;
    function withdraw(
        bytes32 loanId,
        bytes32 accountId,
        uint8 poolId,
        uint256 amount,
        bool isFAmount
    ) external returns (uint256 underlingAmount);
    function withdrawFToken(
        bytes32 loanId,
        bytes32 accountId,
        uint8 poolId,
        address recipient,
        uint256 fAmount
    ) external;
    function borrow(bytes32 loanId, bytes32 accountId, uint8 poolId, uint256 amount, uint256 maxStableRate) external;
    function repay(bytes32 loanId, bytes32 accountId, uint8 poolId, uint256 amount, uint256 maxOverRepayment) external;
    function repayWithCollateral(bytes32 loanId, bytes32 accountId, uint8 poolId, uint256 amount) external;
    function liquidate(
        bytes32 violatorLoanId,
        bytes32 liquidatorLoanId,
        bytes32 liquidatorAccountId,
        uint8 colPoolId,
        uint8 borPoolId,
        uint256 maxRepayAmount,
        uint256 minSeizedAmount
    ) external;
    function switchBorrowType(bytes32 loanId, bytes32 accountId, uint8 poolId, uint256 maxStableRate) external;

    function rebalanceUp(bytes32 loanId, uint8 poolId) external;
    function rebalanceDown(bytes32 loanId, uint8 poolId) external;
}
