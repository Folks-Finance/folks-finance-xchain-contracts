// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20FlashMint.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../bridge/interfaces/IBridgeRouter.sol";
import "../bridge/libraries/Messages.sol";
import "./interfaces/IHubPool.sol";
import "./libraries/DataTypes.sol";
import "./libraries/MathUtils.sol";
import "./logic/HubPoolLogic.sol";
import "./HubPoolState.sol";

abstract contract HubPool is ReentrancyGuard, IHubPool, HubPoolState, ERC20FlashMint {
    bytes32 public constant override HUB_ROLE = keccak256("HUB");
    bytes32 public constant override LOAN_MANAGER_ROLE = keccak256("LOAN_MANAGER");

    uint8 internal fTokenDecimals;

    /**
     * @notice Constructor
     * @param admin The default admin for HubPool
     * @param tokenDecimals The number of decimals of underlying token on Hub
     */
    constructor(
        address admin,
        address hub,
        address loanManager,
        uint8 tokenDecimals,
        string memory fTokenName,
        string memory fTokenSymbol,
        uint8 poolId,
        PoolData memory pooldata,
        IOracleManager oracleManager
    ) HubPoolState(admin, poolId, pooldata, oracleManager) ERC20(fTokenName, fTokenSymbol) {
        fTokenDecimals = tokenDecimals;
        _grantRole(HUB_ROLE, hub);
        _grantRole(LOAN_MANAGER_ROLE, loanManager);
    }

    function getPoolId() external view override returns (uint8) {
        return poolId;
    }

    function getTokenFeeClaimer() external view override returns (address) {
        return _poolData.feeData.tokenFeeClaimer;
    }

    function getTokenFeeRecipient() external view override returns (bytes32) {
        return _poolData.feeData.tokenFeeRecipient;
    }

    function clearTokenFees() external override onlyRole(HUB_ROLE) nonReentrant returns (uint256) {
        uint256 amount = _poolData.feeData.totalRetainedAmount;
        _poolData.feeData.totalRetainedAmount = 0;
        _poolData.depositData.totalAmount -= amount;

        emit ClearTokenFees(amount);
        return amount;
    }

    function verifyReceiveToken(uint16 chainId, bytes32 source) external view override {
        // if the message sender is one of our trusted spokes then we know the
        // deposit/repay transferred the token and the pool was the recipient
        bytes32 spokeAddress = getChainSpoke(chainId);
        if (source != spokeAddress) revert UnmatchedChainSpoke(chainId, source, spokeAddress);
    }

    function getSendTokenMessage(
        IBridgeRouter bridgeRouter,
        uint16 adapterId,
        uint256 gasLimit,
        bytes32 accountId,
        uint16 chainId,
        uint256 amount,
        bytes32 recipient
    ) external override onlyRole(HUB_ROLE) nonReentrant returns (Messages.MessageToSend memory) {
        // check chain is compatible
        bytes32 spokeAddress = getChainSpoke(chainId);

        // prepare message
        Messages.MessageParams memory params = Messages.MessageParams({
            adapterId: adapterId,
            returnAdapterId: 0,
            receiverValue: 0,
            gasLimit: gasLimit,
            returnGasLimit: 0
        });
        bytes memory extraArgs = _sendToken(bridgeRouter, spokeAddress, params, amount);

        // construct message (will be sent from Hub)
        return
            Messages.MessageToSend({
                params: params,
                sender: Messages.convertEVMAddressToGenericAddress(msg.sender),
                destinationChainId: chainId,
                handler: spokeAddress,
                payload: Messages.encodeMessagePayload(
                    Messages.MessagePayload({
                        action: Messages.Action.SendToken,
                        accountId: accountId,
                        userAddress: recipient,
                        data: abi.encodePacked(amount)
                    })
                ),
                finalityLevel: 1, // finalised
                extraArgs: extraArgs
            });
    }

    function getUpdatedDepositInterestIndex() external view override returns (uint256) {
        return HubPoolLogic.getUpdatedDepositInterestIndex(_poolData);
    }

    function getUpdatedVariableBorrowInterestIndex() external view override returns (uint256) {
        return HubPoolLogic.getUpdatedVariableBorrowInterestIndex(_poolData);
    }

    function updateInterestIndexes() external override nonReentrant {
        HubPoolLogic.updateInterestIndexes(_poolData);
    }

    function updatePoolWithDeposit(
        uint256 amount
    ) external override onlyRole(LOAN_MANAGER_ROLE) nonReentrant returns (DataTypes.DepositPoolParams memory) {
        DataTypes.PriceFeed memory priceFeed = _oracleManager.processPriceFeed(poolId);
        return HubPoolLogic.updateWithDeposit(_poolData, amount, priceFeed);
    }

    function preparePoolForWithdraw(
        uint256 amount,
        bool isFAmount
    )
        external
        override
        onlyRole(LOAN_MANAGER_ROLE)
        nonReentrant
        returns (DataTypes.WithdrawPoolParams memory withdrawPoolParams)
    {
        return HubPoolLogic.prepareForWithdraw(_poolData, amount, isFAmount);
    }

    function updatePoolWithWithdraw(
        uint256 underlyingAmount
    ) external override onlyRole(LOAN_MANAGER_ROLE) nonReentrant {
        return HubPoolLogic.updateWithWithdraw(_poolData, underlyingAmount);
    }

    function preparePoolForWithdrawFToken() external override onlyRole(LOAN_MANAGER_ROLE) nonReentrant {
        HubPoolLogic.prepareForWithdrawFToken(_poolData);
    }

    function preparePoolForBorrow(
        uint256 amount,
        uint256 maxStableRate
    )
        external
        override
        onlyRole(LOAN_MANAGER_ROLE)
        nonReentrant
        returns (DataTypes.BorrowPoolParams memory borrowPoolParams)
    {
        DataTypes.PriceFeed memory priceFeed = _oracleManager.processPriceFeed(poolId);
        return HubPoolLogic.prepareForBorrow(_poolData, amount, priceFeed, maxStableRate);
    }

    function updatePoolWithBorrow(
        uint256 amount,
        bool isStable
    ) external override onlyRole(LOAN_MANAGER_ROLE) nonReentrant {
        HubPoolLogic.updateWithBorrow(_poolData, amount, isStable);
    }

    function preparePoolForRepay()
        external
        override
        onlyRole(LOAN_MANAGER_ROLE)
        nonReentrant
        returns (DataTypes.BorrowPoolParams memory)
    {
        return HubPoolLogic.prepareForRepay(_poolData);
    }

    function updatePoolWithRepay(
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 loanStableRate,
        uint256 excessAmount
    ) external override onlyRole(LOAN_MANAGER_ROLE) nonReentrant {
        HubPoolLogic.updateWithRepay(_poolData, principalPaid, interestPaid, loanStableRate, excessAmount);
    }

    function updatePoolWithRepayWithCollateral(
        uint256 principalPaid,
        uint256 interestPaid,
        uint256 loanStableRate
    )
        external
        override
        onlyRole(LOAN_MANAGER_ROLE)
        nonReentrant
        returns (DataTypes.RepayWithCollateralPoolParams memory)
    {
        return HubPoolLogic.updateWithRepayWithCollateral(_poolData, principalPaid, interestPaid, loanStableRate);
    }

    function updatePoolWithLiquidation() external override onlyRole(LOAN_MANAGER_ROLE) nonReentrant {
        HubPoolLogic.updateWithLiquidation(_poolData);
    }

    function preparePoolForSwitchBorrowType(
        uint256 amount,
        uint256 maxStableRate
    )
        external
        override
        onlyRole(LOAN_MANAGER_ROLE)
        nonReentrant
        returns (DataTypes.BorrowPoolParams memory borrowPoolParams)
    {
        return HubPoolLogic.prepareForSwitchBorrowType(_poolData, amount, maxStableRate);
    }

    function updatePoolWithSwitchBorrowType(
        uint256 loanBorrowAmount,
        bool switchingToStable,
        uint256 oldLoanBorrowStableRate
    ) external override onlyRole(LOAN_MANAGER_ROLE) nonReentrant {
        HubPoolLogic.updateWithSwitchBorrowType(
            _poolData,
            loanBorrowAmount,
            switchingToStable,
            oldLoanBorrowStableRate
        );
    }

    function preparePoolForRebalanceUp()
        external
        override
        onlyRole(LOAN_MANAGER_ROLE)
        nonReentrant
        returns (DataTypes.BorrowPoolParams memory borrowPoolParams)
    {
        return HubPoolLogic.prepareForRebalanceUp(_poolData);
    }

    function updatePoolWithRebalanceUp(
        uint256 amount,
        uint256 oldLoanStableInterestRate
    ) external override onlyRole(LOAN_MANAGER_ROLE) nonReentrant {
        HubPoolLogic.updateWithRebalanceUp(_poolData, amount, oldLoanStableInterestRate);
    }

    function preparePoolForRebalanceDown()
        external
        override
        onlyRole(LOAN_MANAGER_ROLE)
        nonReentrant
        returns (DataTypes.RebalanceDownPoolParams memory rebalanceDownPoolParams)
    {
        return HubPoolLogic.prepareForRebalanceDown(_poolData);
    }

    function updatePoolWithRebalanceDown(
        uint256 amount,
        uint256 oldLoanStableInterestRate
    ) external override onlyRole(LOAN_MANAGER_ROLE) nonReentrant {
        HubPoolLogic.updateWithRebalanceDown(_poolData, amount, oldLoanStableInterestRate);
    }

    function mintFTokenForFeeRecipient(uint256 amount) external override onlyRole(LOAN_MANAGER_ROLE) nonReentrant {
        return _mint(_poolData.feeData.fTokenFeeRecipient, amount);
    }

    function mintFToken(address recipient, uint256 amount) external override onlyRole(LOAN_MANAGER_ROLE) nonReentrant {
        return _mint(recipient, amount);
    }

    function burnFToken(address sender, uint256 amount) external override onlyRole(LOAN_MANAGER_ROLE) nonReentrant {
        return _burn(sender, amount);
    }

    function decimals() public view override returns (uint8) {
        return fTokenDecimals;
    }

    function maxFlashLoan(address token) public view override returns (uint256) {
        return _poolData.configData.flashLoanSupported ? super.maxFlashLoan(token) : 0;
    }

    /**
     * @notice Send token from HubPool into adapter if being bridged
     * @param bridgeRouter The bridge router used to send the message through
     * @param recipient The recipient on the destination chain
     * @param params The parameters for sending message to spoke chain
     * @param amount The amount of token to send
     * @return extraArgs needed when sending message
     */
    function _sendToken(
        IBridgeRouter bridgeRouter,
        bytes32 recipient,
        Messages.MessageParams memory params,
        uint256 amount
    ) internal virtual returns (bytes memory extraArgs);

    function _flashFee(address, uint256 value) internal view override returns (uint256) {
        return MathUtils.calcFlashLoanFeeAmount(value, _poolData.feeData.flashLoanFee);
    }

    function _flashFeeReceiver() internal view override returns (address) {
        return _poolData.feeData.fTokenFeeRecipient;
    }
}
