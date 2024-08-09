// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/IHubPool.sol";
import "./interfaces/ILoanManager.sol";
import "./interfaces/IOracleManager.sol";
import "./libraries/DataTypes.sol";
import "./libraries/MathUtils.sol";
import "./LoanManagerState.sol";
import "./logic/LoanManagerLogic.sol";
import "./logic/LoanPoolLogic.sol";
import "./logic/RewardLogic.sol";
import "./logic/UserLoanLogic.sol";

contract LoanManager is ReentrancyGuard, ILoanManager, LoanManagerState {
    using MathUtils for uint256;
    using LoanPoolLogic for LoanManagerState.LoanPool;
    using UserLoanLogic for LoanManagerState.UserLoan;

    bytes32 public constant override HUB_ROLE = keccak256("HUB");
    bytes32 public constant override REBALANCER_ROLE = keccak256("REBALANCER");

    /**
     * @notice Constructor
     * @param admin The default admin for LoanManager
     * @param oracleManager The Oracle Manager to get prices
     */
    constructor(address admin, IOracleManager oracleManager) LoanManagerState(admin, oracleManager) {}

    /**
     * @notice Get pool if added
     * @param poolId The pool id
     */
    function getPool(uint8 poolId) external view override returns (IHubPool) {
        if (!isPoolAdded(poolId)) revert PoolUnknown(poolId);
        return _pools[poolId];
    }

    function createUserLoan(
        bytes4 nonce,
        bytes32 accountId,
        uint16 loanTypeId,
        bytes32 loanName
    ) external override onlyRole(HUB_ROLE) nonReentrant returns (bytes32 loanId) {
        // check loan types exists and is not deprecated
        if (!isLoanTypeCreated(loanTypeId)) revert LoanTypeUnknown(loanTypeId);
        if (isLoanTypeDeprecated(loanTypeId)) revert LoanTypeDeprecated(loanTypeId);

        // generate loan id and check no existing user loan for same loan id
        loanId = keccak256(abi.encodePacked(accountId, nonce));
        if (isUserLoanActive(loanId)) revert UserLoanAlreadyCreated(loanId);

        // create loan
        UserLoan storage userLoan = _userLoans[loanId];
        userLoan.isActive = true;
        userLoan.accountId = accountId;
        userLoan.loanTypeId = loanTypeId;

        emit CreateUserLoan(loanId, accountId, loanTypeId, loanName);
    }

    function deleteUserLoan(bytes32 loanId, bytes32 accountId) external override onlyRole(HUB_ROLE) nonReentrant {
        // check user loan active and account owner
        if (!isUserLoanActive(loanId)) revert UnknownUserLoan(loanId);
        if (!isUserLoanOwner(loanId, accountId)) revert NotAccountOwner(loanId, accountId);

        // ensure loan is empty
        if (!_isUserLoanEmpty(loanId)) revert LoanNotEmpty(loanId);

        // delete by setting isActive to false
        delete _userLoans[loanId];

        emit DeleteUserLoan(loanId, accountId);
    }

    function deposit(
        bytes32 loanId,
        bytes32 accountId,
        uint8 poolId,
        uint256 amount
    ) external override onlyRole(HUB_ROLE) nonReentrant {
        if (!isUserLoanActive(loanId)) revert UnknownUserLoan(loanId);
        if (!isUserLoanOwner(loanId, accountId)) revert NotAccountOwner(loanId, accountId);

        LoanManagerLogic.executeDeposit(
            _userLoans,
            _loanTypes,
            _pools,
            _userPoolRewards,
            DataTypes.ExecuteDepositParams({ loanId: loanId, poolId: poolId, amount: amount })
        );
    }

    function depositFToken(
        bytes32 loanId,
        bytes32 accountId,
        uint8 poolId,
        address sender,
        uint256 fAmount
    ) external override onlyRole(HUB_ROLE) nonReentrant {
        if (!isUserLoanActive(loanId)) revert UnknownUserLoan(loanId);
        if (!isUserLoanOwner(loanId, accountId)) revert NotAccountOwner(loanId, accountId);

        LoanManagerLogic.executeDepositFToken(
            _userLoans,
            _loanTypes,
            _pools,
            _userPoolRewards,
            _oracleManager,
            DataTypes.ExecuteDepositFTokenParams({ loanId: loanId, poolId: poolId, sender: sender, fAmount: fAmount })
        );
    }

    function withdraw(
        bytes32 loanId,
        bytes32 accountId,
        uint8 poolId,
        uint256 amount,
        bool isFAmount
    ) external override onlyRole(HUB_ROLE) nonReentrant returns (uint256 underlingAmount) {
        if (!isUserLoanActive(loanId)) revert UnknownUserLoan(loanId);
        if (!isUserLoanOwner(loanId, accountId)) revert NotAccountOwner(loanId, accountId);

        underlingAmount = LoanManagerLogic.executeWithdraw(
            _userLoans,
            _loanTypes,
            _pools,
            _userPoolRewards,
            _oracleManager,
            DataTypes.ExecuteWithdrawParams({
                loanId: loanId,
                poolId: poolId,
                amount: amount,
                isFAmount: isFAmount,
                checkOverCollateralization: true
            })
        );
    }

    function withdrawFToken(
        bytes32 loanId,
        bytes32 accountId,
        uint8 poolId,
        address recipient,
        uint256 fAmount
    ) external override onlyRole(HUB_ROLE) nonReentrant {
        if (!isUserLoanActive(loanId)) revert UnknownUserLoan(loanId);
        if (!isUserLoanOwner(loanId, accountId)) revert NotAccountOwner(loanId, accountId);

        LoanManagerLogic.executeWithdrawFToken(
            _userLoans,
            _loanTypes,
            _pools,
            _userPoolRewards,
            _oracleManager,
            DataTypes.ExecuteWithdrawFTokenParams({
                loanId: loanId,
                poolId: poolId,
                recipient: recipient,
                fAmount: fAmount
            })
        );
    }

    function borrow(
        bytes32 loanId,
        bytes32 accountId,
        uint8 poolId,
        uint256 amount,
        uint256 maxStableRate
    ) external override onlyRole(HUB_ROLE) nonReentrant {
        if (!isUserLoanActive(loanId)) revert UnknownUserLoan(loanId);
        if (!isUserLoanOwner(loanId, accountId)) revert NotAccountOwner(loanId, accountId);

        LoanManagerLogic.executeBorrow(
            _userLoans,
            _loanTypes,
            _pools,
            _userPoolRewards,
            _oracleManager,
            DataTypes.ExecuteBorrowParams({
                loanId: loanId,
                poolId: poolId,
                amount: amount,
                maxStableRate: maxStableRate
            })
        );
    }

    function repay(
        bytes32 loanId,
        bytes32 accountId,
        uint8 poolId,
        uint256 amount,
        uint256 maxOverRepayment
    ) external override onlyRole(HUB_ROLE) nonReentrant {
        if (!isUserLoanActive(loanId)) revert UnknownUserLoan(loanId);
        if (!isUserLoanOwner(loanId, accountId)) revert NotAccountOwner(loanId, accountId);

        LoanManagerLogic.executeRepay(
            _userLoans,
            _loanTypes,
            _pools,
            _userPoolRewards,
            DataTypes.ExecuteRepayParams({
                loanId: loanId,
                poolId: poolId,
                amount: amount,
                maxOverRepayment: maxOverRepayment
            })
        );
    }

    function repayWithCollateral(
        bytes32 loanId,
        bytes32 accountId,
        uint8 poolId,
        uint256 amount
    ) external override onlyRole(HUB_ROLE) nonReentrant {
        if (!isUserLoanActive(loanId)) revert UnknownUserLoan(loanId);
        if (!isUserLoanOwner(loanId, accountId)) revert NotAccountOwner(loanId, accountId);

        LoanManagerLogic.executeRepayWithCollateral(
            _userLoans,
            _loanTypes,
            _pools,
            _userPoolRewards,
            DataTypes.ExecuteRepayWithCollateralParams({ loanId: loanId, poolId: poolId, amount: amount })
        );
    }

    /**
     * @notice Liquidate an under-collateralised loan by moving specified borrow and collateral to liquidator
     */
    function liquidate(
        bytes32 violatorLoanId,
        bytes32 liquidatorLoanId,
        bytes32 liquidatorAccountId,
        uint8 colPoolId,
        uint8 borPoolId,
        uint256 maxRepayAmount,
        uint256 minSeizedAmount
    ) external override onlyRole(HUB_ROLE) nonReentrant {
        if (!isUserLoanActive(violatorLoanId)) revert UnknownUserLoan(violatorLoanId);
        if (!isUserLoanActive(liquidatorLoanId)) revert UnknownUserLoan(liquidatorLoanId);
        if (!isUserLoanOwner(liquidatorLoanId, liquidatorAccountId))
            revert NotAccountOwner(liquidatorLoanId, liquidatorAccountId);
        if (liquidatorLoanId == violatorLoanId) revert SameLoan(liquidatorLoanId);

        LoanManagerLogic.executeLiquidate(
            _userLoans,
            _loanTypes,
            _pools,
            _userPoolRewards,
            DataTypes.ExecuteLiquidationParams({
                violatorLoanId: violatorLoanId,
                liquidatorLoanId: liquidatorLoanId,
                liquidatorAccountId: liquidatorAccountId,
                colPoolId: colPoolId,
                borPoolId: borPoolId,
                maxRepayAmount: maxRepayAmount,
                minSeizedAmount: minSeizedAmount,
                oracleManager: _oracleManager
            })
        );
    }

    function switchBorrowType(
        bytes32 loanId,
        bytes32 accountId,
        uint8 poolId,
        uint256 maxStableRate
    ) external override onlyRole(HUB_ROLE) nonReentrant {
        if (!isUserLoanActive(loanId)) revert UnknownUserLoan(loanId);
        if (!isUserLoanOwner(loanId, accountId)) revert NotAccountOwner(loanId, accountId);

        LoanManagerLogic.executeSwitchBorrowType(
            _userLoans,
            _pools,
            DataTypes.ExecuteSwitchBorrowTypeParams({ loanId: loanId, poolId: poolId, maxStableRate: maxStableRate })
        );
    }

    /**
     * @notice Permissionless rebalance up a stable borrow
     */
    function rebalanceUp(bytes32 loanId, uint8 poolId) external override onlyRole(REBALANCER_ROLE) nonReentrant {
        if (!isUserLoanActive(loanId)) revert UnknownUserLoan(loanId);

        LoanManagerLogic.executeRebalanceUp(
            _userLoans,
            _pools,
            DataTypes.ExecuteRebalanceParams({ loanId: loanId, poolId: poolId })
        );
    }

    /**
     * @notice Permissionless rebalance down a stable borrow
     */
    function rebalanceDown(bytes32 loanId, uint8 poolId) external override onlyRole(REBALANCER_ROLE) nonReentrant {
        if (!isUserLoanActive(loanId)) revert UnknownUserLoan(loanId);

        LoanManagerLogic.executeRebalanceDown(
            _userLoans,
            _pools,
            DataTypes.ExecuteRebalanceParams({ loanId: loanId, poolId: poolId })
        );
    }

    /// @notice Update the reward indexes for the loan pools
    /// @param loanTypeIds A loan type id array
    /// @param poolIdsForLoanType A matrix of pool ids for each loan type in loanTypeIds
    function updateLoanPoolsRewardIndexes(
        uint16[] calldata loanTypeIds,
        uint8[][] calldata poolIdsForLoanType
    ) external nonReentrant {
        RewardLogic.updateLoanPoolsRewardIndexes(_loanTypes, loanTypeIds, poolIdsForLoanType);
    }

    function updateUserLoansPoolsRewards(bytes32[] calldata loanIds) external nonReentrant {
        RewardLogic.updateUserLoansPoolsRewards(_loanTypes, _userLoans, _userPoolRewards, loanIds);
    }
}
