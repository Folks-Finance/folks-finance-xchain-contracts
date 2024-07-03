// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "./interfaces/IHubPool.sol";
import "./interfaces/IOracleManager.sol";
import "./logic/RewardLogic.sol";

contract LoanManagerState is AccessControlDefaultAdminRules {
    error LoanTypeAlreadyCreated(uint16 loanTypeId);
    error LoanTypeAlreadyDeprecated(uint16 loanTypeId);
    error LoanTypeUnknown(uint16 loanTypeId);
    error LoanTypeDeprecated(uint16 loanTypeId);

    error PoolAlreadyAdded(uint8 poolId);
    error PoolUnknown(uint8 poolId);

    error LoanPoolAlreadyAdded(uint16 loanTypeId, uint8 poolId);
    error LoanPoolAlreadyDeprecated(uint16 loanTypeId, uint8 poolId);
    error LoanPoolUnknown(uint16 loanTypeId, uint8 poolId);
    error LoanPoolDeprecated(uint16 loanTypeId, uint8 poolId);

    error UserLoanInactive(bytes32 loanId);

    error LoanTargetHealthTooLow();
    error CollateralFactorTooHigh();
    error BorrowFactorTooLow();
    error LiquidationBonusTooHigh();
    error LiquidationFeeTooHigh();
    error CollateralRewardIndexTooHigh();
    error BorrowRewardIndexTooHigh();

    struct LoanPool {
        uint256 collateralUsed; // in f token
        uint256 borrowUsed; // in token
        uint64 collateralCap; // $ amount
        uint64 borrowCap; // $ amount
        uint16 collateralFactor; // 4dp
        uint16 borrowFactor; // 4dp
        uint16 liquidationBonus; // 4dp
        uint16 liquidationFee; // 4dp
        bool isAdded;
        bool isDeprecated;
        LoanPoolReward reward;
    }

    struct LoanPoolReward {
        uint64 lastUpdateTimestamp;
        uint256 minimumAmount; // minimum amount to be collateralized or borrowed in pool to update indexes
        uint256 collateralSpeed; // rewards distributed each sec with 18dp
        uint256 borrowSpeed; // rewards distributed each sec with 18dp
        uint256 collateralRewardIndex; // rewards distributed each sec for each collateralized unit with 18dp
        uint256 borrowRewardIndex; // rewards distributed each sec for each borrowed unit with 18dp
    }

    struct LoanType {
        bool isCreated;
        bool isDeprecated;
        uint32 loanTargetHealth; // 4dp, effective coll value/effective bor value ratio to consider loan healthy
        mapping(uint8 poolId => LoanPool) pools;
    }

    struct UserLoanCollateral {
        uint256 balance; // denominated in f token
        uint256 rewardIndex;
    }

    struct UserLoanBorrow {
        uint256 amount; // excluding interest
        uint256 balance; // including interest
        uint256 lastInterestIndex;
        uint256 stableInterestRate; // defined if stable borrow
        uint256 lastStableUpdateTimestamp; // defined if stable borrow
        uint256 rewardIndex;
    }

    struct UserPoolRewards {
        uint256 collateral;
        uint256 borrow;
        uint256 interestPaid;
    }

    struct UserLoan {
        bool isActive;
        bytes32 accountId;
        uint16 loanTypeId;
        uint8[] colPools;
        uint8[] borPools;
        mapping(uint8 poolId => UserLoanCollateral) collaterals;
        mapping(uint8 poolId => UserLoanBorrow) borrows;
    }

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE");
    bytes32 public constant LISTING_ROLE = keccak256("LISTING");

    mapping(uint8 poolId => IHubPool) internal _pools;
    mapping(uint16 loanTypeId => LoanType) internal _loanTypes;
    mapping(bytes32 loanId => UserLoan) internal _userLoans;
    mapping(bytes32 accountId => mapping(uint8 poolId => UserPoolRewards)) internal _userPoolRewards;
    IOracleManager internal _oracleManager;

    constructor(address admin, IOracleManager oracleManager_) AccessControlDefaultAdminRules(1 days, admin) {
        // pools and loan types start empty
        _oracleManager = oracleManager_;

        // initialise role to update parameters
        _grantRole(ORACLE_ROLE, admin);
        _grantRole(LISTING_ROLE, admin);
    }

    /**
     * @notice Privledged operation to update the oracle manager
     * @param newOracleManager The new oracle manager
     */
    function updateOracleManager(IOracleManager newOracleManager) external onlyRole(ORACLE_ROLE) {
        _oracleManager = newOracleManager;
    }

    /**
     * @notice Create loan type
     * @param loanTypeId The loan type id
     */
    function createLoanType(uint16 loanTypeId, uint32 loanTargetHealth) external onlyRole(LISTING_ROLE) {
        if (isLoanTypeCreated(loanTypeId)) revert LoanTypeAlreadyCreated(loanTypeId);

        // check is valid and create loan type
        _checkLoanTargetHealth(loanTargetHealth);
        LoanType storage loanType = _loanTypes[loanTypeId];
        loanType.isCreated = true;
        loanType.isDeprecated = false;
        loanType.loanTargetHealth = loanTargetHealth;
    }

    /**
     * @notice Deprecate loan type
     * @param loanTypeId The loan type id
     */
    function deprecateLoanType(uint16 loanTypeId) external onlyRole(LISTING_ROLE) {
        if (!isLoanTypeCreated(loanTypeId)) revert LoanTypeUnknown(loanTypeId);
        if (isLoanTypeDeprecated(loanTypeId)) revert LoanTypeAlreadyDeprecated(loanTypeId);

        // deprecate loan type
        _loanTypes[loanTypeId].isDeprecated = true;
    }

    function updateLoanTypeLoanTargetHealth(
        uint16 loanTypeId,
        uint32 loanTargetHealth
    ) external onlyRole(LISTING_ROLE) {
        if (!isLoanTypeCreated(loanTypeId)) revert LoanTypeUnknown(loanTypeId);

        // check is valid and update param
        _checkLoanTargetHealth(loanTargetHealth);
        _loanTypes[loanTypeId].loanTargetHealth = loanTargetHealth;
    }

    /**
     * @notice Add pool
     * @param pool The pool to add
     */
    function addPool(IHubPool pool) external onlyRole(LISTING_ROLE) {
        uint8 poolId = pool.getPoolId();
        if (isPoolAdded(poolId)) revert PoolAlreadyAdded(poolId);
        _pools[poolId] = pool;
    }

    /**
     * @notice Add pool to loan type
     * @param loanTypeId The loan type id
     * @param poolId The pool id
     * @param collateralFactor The
     * @param collateralCap The dollar denominated collateral cap (no decimals)
     * @param borrowFactor The
     * @param borrowCap The dollar denominated borrow cap (no decimals)
     */
    function addPoolToLoanType(
        uint16 loanTypeId,
        uint8 poolId,
        uint16 collateralFactor,
        uint64 collateralCap,
        uint16 borrowFactor,
        uint64 borrowCap,
        uint16 liquidationBonus,
        uint16 liquidationFee,
        uint256 rewardCollateralSpeed,
        uint256 rewardBorrowSpeed,
        uint256 rewardMinimumAmount
    ) external onlyRole(LISTING_ROLE) {
        if (!isLoanTypeCreated(loanTypeId)) revert LoanTypeUnknown(loanTypeId);
        if (isLoanTypeDeprecated(loanTypeId)) revert LoanTypeDeprecated(loanTypeId);
        if (!isPoolAdded(poolId)) revert PoolUnknown(poolId);
        if (isPoolInLoanType(loanTypeId, poolId)) revert LoanPoolAlreadyAdded(loanTypeId, poolId);

        // check is valid and add pool to loan type
        _checkLoanPoolCollateralFactor(collateralFactor);
        _checkLoanPoolBorrowFactor(borrowFactor);
        _checkLoanPoolLiquidation(liquidationBonus, liquidationFee);
        _checkRewardParams(rewardCollateralSpeed, rewardBorrowSpeed, rewardMinimumAmount);
        _loanTypes[loanTypeId].pools[poolId] = LoanPool({
            isAdded: true,
            isDeprecated: false,
            collateralFactor: collateralFactor,
            collateralUsed: 0,
            collateralCap: collateralCap,
            borrowFactor: borrowFactor,
            borrowUsed: 0,
            borrowCap: borrowCap,
            liquidationBonus: liquidationBonus,
            liquidationFee: liquidationFee,
            reward: LoanPoolReward({
                collateralSpeed: rewardCollateralSpeed,
                borrowSpeed: rewardBorrowSpeed,
                minimumAmount: rewardMinimumAmount,
                collateralRewardIndex: 0,
                borrowRewardIndex: 0,
                lastUpdateTimestamp: SafeCast.toUint64(block.timestamp)
            })
        });
    }

    /**
     * @notice Deprecate pool in loan type
     * @param loanTypeId The loan type id
     * @param poolId The pool id
     */
    function deprecatePoolInLoanType(uint16 loanTypeId, uint8 poolId) external onlyRole(LISTING_ROLE) {
        if (!isLoanTypeCreated(loanTypeId)) revert LoanTypeUnknown(loanTypeId);
        if (!isPoolInLoanType(loanTypeId, poolId)) revert LoanPoolUnknown(loanTypeId, poolId);
        if (isPoolInLoanTypeDeprecated(loanTypeId, poolId)) revert LoanPoolAlreadyDeprecated(loanTypeId, poolId);

        // deprecate pool in loan type
        _loanTypes[loanTypeId].pools[poolId].isDeprecated = true;
    }

    function updateLoanPoolCaps(
        uint16 loanTypeId,
        uint8 poolId,
        uint64 collateralCap,
        uint64 borrowCap
    ) external onlyRole(LISTING_ROLE) {
        if (!isLoanTypeCreated(loanTypeId)) revert LoanTypeUnknown(loanTypeId);
        if (!isPoolInLoanType(loanTypeId, poolId)) revert LoanPoolUnknown(loanTypeId, poolId);

        // update params (no check needed on values)
        _loanTypes[loanTypeId].pools[poolId].collateralCap = collateralCap;
        _loanTypes[loanTypeId].pools[poolId].borrowCap = borrowCap;
    }

    function updateLoanPoolCollateralFactor(
        uint16 loanTypeId,
        uint8 poolId,
        uint16 collateralFactor
    ) external onlyRole(LISTING_ROLE) {
        if (!isLoanTypeCreated(loanTypeId)) revert LoanTypeUnknown(loanTypeId);
        if (!isPoolInLoanType(loanTypeId, poolId)) revert LoanPoolUnknown(loanTypeId, poolId);

        // check is valid and update param
        _checkLoanPoolCollateralFactor(collateralFactor);
        _loanTypes[loanTypeId].pools[poolId].collateralFactor = collateralFactor;
    }

    function updateLoanPoolBorrowFactor(
        uint16 loanTypeId,
        uint8 poolId,
        uint16 borrowFactor
    ) external onlyRole(LISTING_ROLE) {
        if (!isLoanTypeCreated(loanTypeId)) revert LoanTypeUnknown(loanTypeId);
        if (!isPoolInLoanType(loanTypeId, poolId)) revert LoanPoolUnknown(loanTypeId, poolId);

        // check is valid and update param
        _checkLoanPoolBorrowFactor(borrowFactor);
        _loanTypes[loanTypeId].pools[poolId].borrowFactor = borrowFactor;
    }

    function updateLoanPoolLiquidation(
        uint16 loanTypeId,
        uint8 poolId,
        uint16 liquidationBonus,
        uint16 liquidationFee
    ) external onlyRole(LISTING_ROLE) {
        if (!isLoanTypeCreated(loanTypeId)) revert LoanTypeUnknown(loanTypeId);
        if (!isPoolInLoanType(loanTypeId, poolId)) revert LoanPoolUnknown(loanTypeId, poolId);

        // check is valid and update params
        _checkLoanPoolLiquidation(liquidationBonus, liquidationFee);
        _loanTypes[loanTypeId].pools[poolId].liquidationBonus = liquidationBonus;
        _loanTypes[loanTypeId].pools[poolId].liquidationFee = liquidationFee;
    }

    function updateRewardParams(
        uint16 loanTypeId,
        uint8 poolId,
        uint256 collateralSpeed,
        uint256 borrowSpeed,
        uint256 minimumAmount
    ) external onlyRole(LISTING_ROLE) {
        if (!isLoanTypeCreated(loanTypeId)) revert LoanTypeUnknown(loanTypeId);
        if (!isPoolInLoanType(loanTypeId, poolId)) revert LoanPoolUnknown(loanTypeId, poolId);

        // ensure indexes are updated before we update
        LoanPool storage loanPool = _loanTypes[loanTypeId].pools[poolId];
        RewardLogic.updateRewardIndexes(loanPool, poolId);

        // check is valid and update params
        _checkRewardParams(collateralSpeed, borrowSpeed, minimumAmount);
        LoanPoolReward storage reward = loanPool.reward;
        reward.collateralSpeed = collateralSpeed;
        reward.borrowSpeed = borrowSpeed;
        reward.minimumAmount = minimumAmount;
    }

    function getLoanPool(uint16 loanTypeId, uint8 poolId) external view returns (LoanPool memory) {
        if (!isLoanTypeCreated(loanTypeId)) revert LoanTypeUnknown(loanTypeId);
        if (!isPoolInLoanType(loanTypeId, poolId)) revert LoanPoolUnknown(loanTypeId, poolId);
        return _loanTypes[loanTypeId].pools[poolId];
    }

    function getUserLoan(
        bytes32 loanId
    )
        external
        view
        returns (
            bytes32 accountId,
            uint16 loanTypeId,
            uint8[] memory colPools,
            uint8[] memory borPools,
            UserLoanCollateral[] memory,
            UserLoanBorrow[] memory
        )
    {
        if (!isUserLoanActive(loanId)) revert UserLoanInactive(loanId);

        colPools = _userLoans[loanId].colPools;
        borPools = _userLoans[loanId].borPools;

        UserLoanCollateral[] memory collaterals = new UserLoanCollateral[](colPools.length);
        UserLoanBorrow[] memory borrows = new UserLoanBorrow[](borPools.length);

        for (uint256 i = 0; i < colPools.length; ) {
            collaterals[i] = _userLoans[loanId].collaterals[colPools[i]];
            ++i;
        }
        for (uint256 i = 0; i < borPools.length; ) {
            borrows[i] = _userLoans[loanId].borrows[borPools[i]];
            ++i;
        }

        return (_userLoans[loanId].accountId, _userLoans[loanId].loanTypeId, colPools, borPools, collaterals, borrows);
    }

    function getUserPoolRewards(bytes32 accountId, uint8 poolId) external view returns (UserPoolRewards memory) {
        return _userPoolRewards[accountId][poolId];
    }

    function getOracleManager() external view returns (address) {
        return address(_oracleManager);
    }

    /**
     * @notice Check if pool is added
     * @param poolId The pool id
     */
    function isPoolAdded(uint8 poolId) public view returns (bool) {
        return address(_pools[poolId]) != address(0);
    }

    /**
     * @notice Check if loan type is created
     * @param loanTypeId The loan type id
     */
    function isLoanTypeCreated(uint16 loanTypeId) public view returns (bool) {
        return _loanTypes[loanTypeId].isCreated;
    }

    /**
     * @notice Check if loan type is deprecated
     * @param loanTypeId The loan type id
     */
    function isLoanTypeDeprecated(uint16 loanTypeId) public view returns (bool) {
        return _loanTypes[loanTypeId].isDeprecated;
    }

    /**
     * @notice Get loan type loan target health
     * @param loanTypeId The loan type id
     */
    function getLoanTypeLoanTargetHealth(uint16 loanTypeId) public view returns (uint256) {
        if (!isLoanTypeCreated(loanTypeId)) revert LoanTypeUnknown(loanTypeId);
        return _loanTypes[loanTypeId].loanTargetHealth;
    }

    /**
     * @notice Check if pool is added to loan type
     * @param loanTypeId The loan type id
     * @param poolId The pool id
     */
    function isPoolInLoanType(uint16 loanTypeId, uint8 poolId) public view returns (bool) {
        return _loanTypes[loanTypeId].pools[poolId].isAdded;
    }

    /**
     * @notice Check if pool in loan type is deprecated
     * @param loanTypeId The loan type id
     * @param poolId The pool id
     */
    function isPoolInLoanTypeDeprecated(uint16 loanTypeId, uint8 poolId) public view returns (bool) {
        return _loanTypes[loanTypeId].pools[poolId].isDeprecated;
    }

    function isUserLoanActive(bytes32 loanId) public view returns (bool) {
        return _userLoans[loanId].isActive;
    }

    function isUserLoanOwner(bytes32 loanId, bytes32 accountId) public view returns (bool) {
        return _userLoans[loanId].accountId == accountId;
    }

    function getType(bytes32 loanId) public view returns (uint16) {
        return _userLoans[loanId].loanTypeId;
    }

    function _checkLoanTargetHealth(uint32 loanTargetHealth) internal pure {
        // loanTargetHealth >= 100%, considering 4 d.p.
        if (loanTargetHealth < 1e4) revert LoanTargetHealthTooLow();
    }

    function _checkLoanPoolCollateralFactor(uint16 collateralFactor) internal pure {
        // collateralFactor <= 100%, considering 4 d.p.
        if (collateralFactor > 1e4) revert CollateralFactorTooHigh();
    }

    function _checkLoanPoolBorrowFactor(uint16 borrowFactor) internal pure {
        //  borrowFactor >= 100%, considering 4 d.p.
        if (borrowFactor < 1e4) revert BorrowFactorTooLow();
    }

    function _checkLoanPoolLiquidation(uint16 liquidationBonus, uint16 liquidationFee) internal pure {
        // liquidationBonus <= 100%, considering 4 d.p.
        if (liquidationBonus > 1e4) revert LiquidationBonusTooHigh();
        // liquidationFee <= 100%, considering 4 d.p.
        if (liquidationFee > 1e4) revert LiquidationFeeTooHigh();
    }

    function _checkRewardParams(uint256 collateralSpeed, uint256 borrowSpeed, uint256 minimumAmount) internal pure {
        // ensure won't overflow in next 100 years
        Math.mulDiv(collateralSpeed, 36525 days, minimumAmount);
        Math.mulDiv(borrowSpeed, 36525 days, minimumAmount);
    }

    function _isUserLoanEmpty(bytes32 loanId) internal view returns (bool) {
        return _userLoans[loanId].colPools.length == 0 && _userLoans[loanId].borPools.length == 0;
    }
}
