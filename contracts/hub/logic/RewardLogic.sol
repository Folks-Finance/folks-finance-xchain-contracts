// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../libraries/MathUtils.sol";
import "../LoanManagerState.sol";

library RewardLogic {
    using MathUtils for uint256;

    event RewardIndexesUpdated(
        uint8 poolId,
        uint256 collateralRewardIndex,
        uint256 borrowRewardIndex,
        uint256 lastUpdateTimestamp
    );

    function updateUserCollateralReward(
        mapping(bytes32 accountId => mapping(uint8 poolId => LoanManagerState.UserPoolRewards)) storage userPoolRewards,
        LoanManagerState.UserLoan storage loan,
        LoanManagerState.LoanPool storage loanPool,
        uint8 poolId
    ) internal {
        LoanManagerState.UserPoolRewards storage userLoanPoolRewards = userPoolRewards[loan.accountId][poolId];
        LoanManagerState.UserLoanCollateral storage userLoanCollateral = loan.collaterals[poolId];
        uint256 collateralRewardIndex = loanPool.reward.collateralRewardIndex;

        userLoanPoolRewards.collateral += MathUtils.calcAccruedRewards(
            userLoanCollateral.balance,
            collateralRewardIndex,
            userLoanCollateral.rewardIndex
        );

        userLoanCollateral.rewardIndex = collateralRewardIndex;
    }

    function updateUserBorrowReward(
        mapping(bytes32 accountId => mapping(uint8 poolId => LoanManagerState.UserPoolRewards)) storage userPoolRewards,
        LoanManagerState.UserLoan storage loan,
        LoanManagerState.LoanPool storage loanPool,
        uint8 poolId
    ) internal {
        LoanManagerState.UserPoolRewards storage userLoanPoolRewards = userPoolRewards[loan.accountId][poolId];
        LoanManagerState.UserLoanBorrow storage userLoanBorrow = loan.borrows[poolId];
        uint256 borrowRewardIndex = loanPool.reward.borrowRewardIndex;

        userLoanPoolRewards.borrow += MathUtils.calcAccruedRewards(
            userLoanBorrow.amount,
            borrowRewardIndex,
            userLoanBorrow.rewardIndex
        );

        userLoanBorrow.rewardIndex = borrowRewardIndex;
    }

    function updateUserBorrowRewardWithRepayment(
        mapping(bytes32 accountId => mapping(uint8 poolId => LoanManagerState.UserPoolRewards)) storage userPoolRewards,
        LoanManagerState.UserLoan storage loan,
        LoanManagerState.LoanPool storage loanPool,
        uint8 poolId,
        uint256 principalPaid,
        uint256 interestPaid
    ) internal {
        LoanManagerState.UserPoolRewards storage userLoanPoolRewards = userPoolRewards[loan.accountId][poolId];
        LoanManagerState.UserLoanBorrow storage userLoanBorrow = loan.borrows[poolId];
        uint256 borrowRewardIndex = loanPool.reward.borrowRewardIndex;

        userLoanPoolRewards.interestPaid += interestPaid;
        if (principalPaid > 0) {
            userLoanPoolRewards.borrow += MathUtils.calcAccruedRewards(
                userLoanBorrow.amount + principalPaid,
                borrowRewardIndex,
                userLoanBorrow.rewardIndex
            );
            userLoanBorrow.rewardIndex = borrowRewardIndex;
        }
    }

    function updateRewardIndexes(LoanManagerState.LoanPool storage loanPool, uint8 poolId) internal {
        LoanManagerState.LoanPoolReward storage loanPoolReward = loanPool.reward;
        uint256 oldLastUpdateTimestamp = loanPoolReward.lastUpdateTimestamp;

        if (block.timestamp > oldLastUpdateTimestamp) {
            uint256 collateralRewardIndex = loanPoolReward.collateralRewardIndex;
            uint256 borrowRewardIndex = loanPoolReward.borrowRewardIndex;
            uint256 lastUpdateTimestamp = block.timestamp;

            uint256 minimumAmount = loanPoolReward.minimumAmount;
            uint256 collateralUsed = loanPool.collateralUsed;
            uint256 borrowUsed = loanPool.borrowUsed;

            if (collateralUsed > minimumAmount) {
                collateralRewardIndex += MathUtils.calcRewardIndexIncrement(
                    oldLastUpdateTimestamp,
                    loanPoolReward.collateralSpeed,
                    collateralUsed
                );
                loanPoolReward.collateralRewardIndex = collateralRewardIndex;
            }

            if (borrowUsed > minimumAmount) {
                borrowRewardIndex += MathUtils.calcRewardIndexIncrement(
                    oldLastUpdateTimestamp,
                    loanPoolReward.borrowSpeed,
                    borrowUsed
                );
                loanPoolReward.borrowRewardIndex = borrowRewardIndex;
            }

            loanPoolReward.lastUpdateTimestamp = SafeCast.toUint64(lastUpdateTimestamp);

            emit RewardIndexesUpdated(poolId, collateralRewardIndex, borrowRewardIndex, lastUpdateTimestamp);
        }
    }

    function updateLoanPoolsRewardIndexes(
        mapping(uint16 loanTypeId => LoanManagerState.LoanType) storage loanTypes,
        uint16[] calldata loanTypeIds,
        uint8[][] calldata poolIdsForLoanType
    ) external {
        uint16 loanTypeId;
        uint8[] memory poolIds;
        for (uint256 i = 0; i < loanTypeIds.length; ) {
            loanTypeId = loanTypeIds[i];
            poolIds = poolIdsForLoanType[i];
            for (uint256 j = 0; j < poolIds.length; ) {
                updateRewardIndexes(loanTypes[loanTypeId].pools[poolIds[j]], poolIds[j]);
                unchecked {
                    ++j;
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    function updateUserLoansPoolsRewards(
        mapping(uint16 loanTypeId => LoanManagerState.LoanType) storage loanTypes,
        mapping(bytes32 => LoanManagerState.UserLoan) storage userLoans,
        mapping(bytes32 accountId => mapping(uint8 poolId => LoanManagerState.UserPoolRewards)) storage userPoolRewards,
        bytes32[] calldata loanIds
    ) external {
        uint16 loanTypeId;
        uint8[] memory pools;
        uint8 poolId;
        for (uint256 i = 0; i < loanIds.length; ) {
            LoanManagerState.UserLoan storage userLoan = userLoans[loanIds[i]];

            loanTypeId = userLoan.loanTypeId;
            pools = userLoan.colPools;
            for (uint256 j = 0; j < pools.length; ) {
                poolId = pools[j];
                LoanManagerState.LoanPool storage loanPool = loanTypes[loanTypeId].pools[poolId];

                updateRewardIndexes(loanPool, poolId);
                updateUserCollateralReward(userPoolRewards, userLoan, loanPool, poolId);
                unchecked {
                    ++j;
                }
            }

            pools = userLoan.borPools;
            for (uint256 j = 0; j < pools.length; ) {
                poolId = pools[j];
                LoanManagerState.LoanPool storage loanPool = loanTypes[loanTypeId].pools[poolId];

                updateRewardIndexes(loanPool, poolId);
                updateUserBorrowReward(userPoolRewards, userLoan, loanPool, poolId);
                unchecked {
                    ++j;
                }
            }
            unchecked {
                ++i;
            }
        }
    }
}
