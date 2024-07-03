// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "./interfaces/IOracleManager.sol";
import "./libraries/MathUtils.sol";
import "./logic/HubPoolLogic.sol";

contract HubPoolState is AccessControlDefaultAdminRules {
    error NoChainSpoke(uint16 chainId);
    error ExistingChainSpoke(uint16 chainId);

    error FlashLoanFeeTooHigh();
    error RetentionRateTooHigh();
    error OptimalUtilisationRatioTooLow();
    error OptimalUtilisationRatioTooHigh();
    error MaxVariableInterestRateTooHigh();
    error MaxStableInterestRateTooHigh();
    error OptimalStableToTotalDebtRatioTooHigh();
    error RebalanceUpUtilisationRatioTooHigh();
    error RebalanceUpDepositInterestRateTooHigh();
    error StableBorrowPercentageTooHigh();

    struct FeeData {
        uint32 flashLoanFee; // 6 d.p.
        uint32 retentionRate; // 6 d.p.
        address fTokenFeeRecipient; // for liquidation fees and flash loan fees
        address tokenFeeClaimer; // address which can initiate the claim token fees from hub
        uint256 totalRetainedAmount; // includes % of interest and excess repayments
        bytes32 tokenFeeRecipient; // for total retained amount (received at given spoke)
    }

    struct DepositData {
        uint16 optimalUtilisationRatio; // 4 d.p.
        uint256 totalAmount;
        uint256 interestRate; // 18 d.p.
        uint256 interestIndex; // 18 d.p.
    }

    struct VariableBorrowData {
        uint32 vr0; // 6 d.p.
        uint32 vr1; // 6 d.p.
        uint32 vr2; // 6 d.p.
        uint256 totalAmount;
        uint256 interestRate; // 18 d.p.
        uint256 interestIndex; // 18 d.p.
    }

    struct StableBorrowData {
        uint32 sr0; // 6 d.p.
        uint32 sr1; // 6 d.p.
        uint32 sr2; // 6 d.p.
        uint32 sr3; // 6 d.p.
        uint16 optimalStableToTotalDebtRatio; // 4 d.p.
        uint16 rebalanceUpUtilisationRatio; // 4 d.p.
        uint16 rebalanceUpDepositInterestRate; // 4 d.p.
        uint16 rebalanceDownDelta; // 4 d.p.
        uint256 totalAmount;
        uint256 interestRate; // 18 d.p.
        uint256 averageInterestRate; // 18 d.p.
    }

    struct CapsData {
        uint64 deposit; // $ amount
        uint64 borrow; // $ amount
        uint64 stableBorrowPercentage; // 18 d.p.
    }

    struct ConfigData {
        bool deprecated;
        bool stableBorrowSupported;
        bool canMintFToken;
        bool flashLoanSupported;
    }

    struct PoolData {
        uint256 lastUpdateTimestamp;
        FeeData feeData;
        DepositData depositData;
        VariableBorrowData variableBorrowData;
        StableBorrowData stableBorrowData;
        CapsData capsData;
        ConfigData configData;
    }

    struct PoolAmountDataCache {
        uint256 variableBorrowTotalAmount;
        uint256 stableBorrowTotalAmount;
    }

    bytes32 public constant PARAM_ROLE = keccak256("PARAM");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE");

    uint8 public immutable poolId;
    mapping(uint16 chainId => bytes32 spokeAddress) internal _spokes;
    PoolData internal _poolData;
    IOracleManager internal _oracleManager;

    constructor(
        address admin,
        uint8 poolId_,
        PoolData memory poolData_,
        IOracleManager oracleManager_
    ) AccessControlDefaultAdminRules(1 days, admin) {
        poolId = poolId_;

        // setup pool data
        poolData_.feeData.totalRetainedAmount = 0;
        poolData_.depositData.totalAmount = 0;
        poolData_.depositData.interestIndex = MathUtils.ONE_18_DP;
        poolData_.variableBorrowData.totalAmount = 0;
        poolData_.variableBorrowData.interestIndex = MathUtils.ONE_18_DP;
        poolData_.stableBorrowData.totalAmount = 0;
        poolData_.stableBorrowData.averageInterestRate = 0;
        poolData_.lastUpdateTimestamp = block.timestamp;
        _poolData = poolData_;

        // set oracle manager
        _oracleManager = oracleManager_;

        // check params in valid range
        _checkFeeData();
        _checkDepositData();
        _checkVariableBorrowData();
        _checkStableBorrowData();
        _checkCapsData();

        // initialise interest rates
        HubPoolLogic.updateInterestRates(_poolData);

        // initialise role to update parameters
        _grantRole(PARAM_ROLE, admin);
        _grantRole(ORACLE_ROLE, admin);
    }

    function getLastUpdateTimestamp() external view returns (uint256) {
        return _poolData.lastUpdateTimestamp;
    }

    function getFeeData() external view returns (FeeData memory) {
        return _poolData.feeData;
    }

    function getDepositData() external view returns (DepositData memory) {
        return _poolData.depositData;
    }

    function getVariableBorrowData() external view returns (VariableBorrowData memory) {
        return _poolData.variableBorrowData;
    }

    function getStableBorrowData() external view returns (StableBorrowData memory) {
        return _poolData.stableBorrowData;
    }

    function getCapsData() external view returns (CapsData memory) {
        return _poolData.capsData;
    }

    function getConfigData() external view returns (ConfigData memory) {
        return _poolData.configData;
    }

    function getOracleManager() external view returns (address) {
        return address(_oracleManager);
    }

    function updateFeeData(
        uint32 flashLoanFee,
        uint32 retentionRate,
        address fTokenFeeRecipient,
        address tokenFeeClaimer,
        bytes32 tokenFeeRecipient
    ) external onlyRole(PARAM_ROLE) {
        HubPoolLogic.updateInterestIndexes(_poolData);
        _poolData.feeData.flashLoanFee = flashLoanFee;
        _poolData.feeData.retentionRate = retentionRate;
        _poolData.feeData.fTokenFeeRecipient = fTokenFeeRecipient;
        _poolData.feeData.tokenFeeClaimer = tokenFeeClaimer;
        _poolData.feeData.tokenFeeRecipient = tokenFeeRecipient;
        _checkFeeData();
        HubPoolLogic.updateInterestRates(_poolData);
    }

    function updateDepositData(uint16 optimalUtilisationRatio) external onlyRole(PARAM_ROLE) {
        HubPoolLogic.updateInterestIndexes(_poolData);
        _poolData.depositData.optimalUtilisationRatio = optimalUtilisationRatio;
        _checkDepositData();
        HubPoolLogic.updateInterestRates(_poolData);
    }

    function updateVariableBorrowData(uint32 vr0, uint32 vr1, uint32 vr2) external onlyRole(PARAM_ROLE) {
        HubPoolLogic.updateInterestIndexes(_poolData);
        _poolData.variableBorrowData.vr0 = vr0;
        _poolData.variableBorrowData.vr1 = vr1;
        _poolData.variableBorrowData.vr2 = vr2;
        _checkVariableBorrowData();
        HubPoolLogic.updateInterestRates(_poolData);
    }

    function updateStableBorrowData(
        uint32 sr0,
        uint32 sr1,
        uint32 sr2,
        uint32 sr3,
        uint16 optimalStableToTotalDebtRatio,
        uint16 rebalanceUpUtilisationRatio,
        uint16 rebalanceUpDepositInterestRate,
        uint16 rebalanceDownDelta
    ) external onlyRole(PARAM_ROLE) {
        HubPoolLogic.updateInterestIndexes(_poolData);
        _poolData.stableBorrowData.sr0 = sr0;
        _poolData.stableBorrowData.sr1 = sr1;
        _poolData.stableBorrowData.sr2 = sr2;
        _poolData.stableBorrowData.sr3 = sr3;
        _poolData.stableBorrowData.optimalStableToTotalDebtRatio = optimalStableToTotalDebtRatio;
        _poolData.stableBorrowData.rebalanceUpUtilisationRatio = rebalanceUpUtilisationRatio;
        _poolData.stableBorrowData.rebalanceUpDepositInterestRate = rebalanceUpDepositInterestRate;
        _poolData.stableBorrowData.rebalanceDownDelta = rebalanceDownDelta;
        _checkStableBorrowData();
        HubPoolLogic.updateInterestRates(_poolData);
    }

    function updateCapsData(CapsData memory capsData) external onlyRole(PARAM_ROLE) {
        _poolData.capsData = capsData;
        _checkCapsData();
    }

    function updateConfigData(ConfigData memory configData) external onlyRole(PARAM_ROLE) {
        _poolData.configData = configData;
    }

    /**
     * @notice Privledged operation to update the oracle manager
     * @param newOracleManager The new oracle manager
     */
    function updateOracleManager(IOracleManager newOracleManager) external onlyRole(ORACLE_ROLE) {
        _oracleManager = newOracleManager;
    }

    function getChainSpoke(uint16 chainId) public view returns (bytes32) {
        bytes32 spoke = _spokes[chainId];
        if (spoke == "") revert NoChainSpoke(chainId);
        return spoke;
    }

    function _checkFeeData() internal view {
        // flashLoanFee <= 10%, considering 6 d.p.
        if (_poolData.feeData.flashLoanFee > 1e5) revert FlashLoanFeeTooHigh();

        // retentionRate <= 100%, considering 6 d.p.
        if (_poolData.feeData.retentionRate > 1e6) revert RetentionRateTooHigh();
    }

    function _checkDepositData() internal view {
        // 0 < optimalUtilisationRatio < 1, considering 4 d.p.
        if (_poolData.depositData.optimalUtilisationRatio == 0) revert OptimalUtilisationRatioTooLow();
        if (_poolData.depositData.optimalUtilisationRatio >= 1e4) revert OptimalUtilisationRatioTooHigh();
    }

    function _checkVariableBorrowData() internal view {
        // max interest rate <= 10,000%, considering 6 d.p.
        if (
            _poolData.variableBorrowData.vr0 + _poolData.variableBorrowData.vr1 + _poolData.variableBorrowData.vr2 >
            100e6
        ) revert MaxVariableInterestRateTooHigh();
    }

    function _checkStableBorrowData() internal view {
        // max interest rate <= 10,000%, considering 6 d.p.
        if (
            _poolData.stableBorrowData.sr0 +
                _poolData.variableBorrowData.vr1 +
                _poolData.stableBorrowData.sr1 +
                _poolData.stableBorrowData.sr2 +
                _poolData.stableBorrowData.sr3 >
            100e6
        ) revert MaxStableInterestRateTooHigh();

        // optimalStableToTotalDebtRatio < 100%, considering 4 d.p.
        if (_poolData.stableBorrowData.optimalStableToTotalDebtRatio >= 1e4)
            revert OptimalStableToTotalDebtRatioTooHigh();

        // rebalanceUpUtilisationRatio <= 100%, considering 4 d.p.
        if (_poolData.stableBorrowData.rebalanceUpUtilisationRatio > 1e4) revert RebalanceUpUtilisationRatioTooHigh();

        // rebalanceUpDepositInterestRate <= 100%, considering 4 d.p.
        if (_poolData.stableBorrowData.rebalanceUpDepositInterestRate > 1e4)
            revert RebalanceUpDepositInterestRateTooHigh();
    }

    function _checkCapsData() internal view {
        // stableBorrowPercentage <= 100%, considering 18 d.p.
        if (_poolData.capsData.stableBorrowPercentage > 1e18) revert StableBorrowPercentageTooHigh();
    }

    function _addChainSpoke(uint16 chainId, bytes32 spokeAddress) internal {
        if (_spokes[chainId] != "") revert ExistingChainSpoke(chainId);
        _spokes[chainId] = spokeAddress;
    }

    function _removeChainSpoke(uint16 chainId) internal {
        if (_spokes[chainId] == "") revert NoChainSpoke(chainId);
        delete _spokes[chainId];
    }
}
