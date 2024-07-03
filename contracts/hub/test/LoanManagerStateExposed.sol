// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "../LoanManagerState.sol";
import "../interfaces/IOracleManager.sol";

contract LoanManagerStateExposed is LoanManagerState {
    constructor(address admin, IOracleManager oracleManager) LoanManagerState(admin, oracleManager) {}

    function setUserLoan(
        bytes32 loanId,
        bool isActive,
        bytes32 accountId,
        uint16 loanTypeId,
        uint8[] memory colPools,
        uint8[] memory borPools,
        UserLoanCollateral[] memory collaterals,
        UserLoanBorrow[] memory borrows
    ) external {
        _userLoans[loanId].isActive = isActive;
        _userLoans[loanId].accountId = accountId;
        _userLoans[loanId].loanTypeId = loanTypeId;
        _userLoans[loanId].colPools = colPools;
        _userLoans[loanId].borPools = borPools;
        for (uint256 i = 0; i < colPools.length; ) {
            _userLoans[loanId].collaterals[colPools[i]] = collaterals[i];
            ++i;
        }
        for (uint256 i = 0; i < borPools.length; ) {
            _userLoans[loanId].borrows[borPools[i]] = borrows[i];
            ++i;
        }
    }

    function setUserPoolRewards(bytes32 accountId, uint8 poolId, UserPoolRewards memory rewards) external {
        _userPoolRewards[accountId][poolId] = rewards;
    }
}
