// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@solidity-bytes-utils/contracts/BytesLib.sol";

import "../bridge/BridgeMessenger.sol";
import "../bridge/interfaces/IBridgeRouter.sol";
import "../bridge/libraries/Messages.sol";
import "./interfaces/IAddressOracle.sol";
import "./RateLimited.sol";
import "./SpokeState.sol";

abstract contract SpokeToken is BridgeMessenger, SpokeState, RateLimited {
    using BytesLib for bytes;

    error HubUnknown(uint16 chainId, bytes32 addr);

    uint8 public immutable poolId;

    constructor(
        address admin,
        IBridgeRouter bridgeRouter,
        uint16 hubChainId,
        bytes32 hubContractAddress,
        IAddressOracle addressOracle,
        BucketConfig memory bucketConfig,
        uint8 poolId_
    )
        BridgeMessenger(bridgeRouter)
        SpokeState(admin, hubChainId, hubContractAddress, addressOracle)
        RateLimited(admin, bucketConfig)
    {
        poolId = poolId_;
    }

    /**
     * @notice Create loan and deposit token into new loan
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id of the loan
     * @param nonce The nonce used to generate the loan id
     * @param amount The amount to deposit
     * @param loanTypeId The load type to create
     * @param loanName The loan name to help identify the loan to user
     */
    function createLoanAndDeposit(
        Messages.MessageParams memory params,
        bytes32 accountId,
        bytes4 nonce,
        uint256 amount,
        uint16 loanTypeId,
        bytes32 loanName
    ) external payable nonReentrant {
        _doOperation(
            params,
            Messages.Action.CreateLoanAndDeposit,
            accountId,
            amount,
            abi.encodePacked(nonce, poolId, amount, loanTypeId, loanName)
        );
    }

    /**
     * @notice Deposit token into specified loan
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id of the loan
     * @param loanId The loan id to deposit into
     * @param amount The amount to deposit
     */
    function deposit(
        Messages.MessageParams memory params,
        bytes32 accountId,
        bytes32 loanId,
        uint256 amount
    ) external payable nonReentrant {
        _doOperation(params, Messages.Action.Deposit, accountId, amount, abi.encodePacked(loanId, poolId, amount));
    }

    /**
     * @notice Repay borrow in specified loan
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id of the loan
     * @param loanId The loan id to repay in
     * @param amount The amount to repay
     * @param maxOverRepayment The maximum acceptable threshold to over-repay by (excess not refunded)
     */
    function repay(
        Messages.MessageParams memory params,
        bytes32 accountId,
        bytes32 loanId,
        uint256 amount,
        uint256 maxOverRepayment
    ) external payable nonReentrant {
        _doOperation(
            params,
            Messages.Action.Repay,
            accountId,
            amount,
            abi.encodePacked(loanId, poolId, amount, maxOverRepayment)
        );
    }

    function _doOperation(
        Messages.MessageParams memory params,
        Messages.Action action,
        bytes32 accountId,
        uint256 amount,
        bytes memory data
    ) internal {
        // check sender is eligible to do given action
        if (!_addressOracle.isEligible(msg.sender, uint16(action)))
            revert IAddressOracle.AddressIneligible(msg.sender, uint16(action));

        // increase rate limit token capacity temporarily for period
        _increaseCapacity(amount);

        // receive tokens from msg.sender
        (bytes memory extraArgs, uint256 feeAmount) = _receiveToken(params, amount);

        // construct message
        Messages.MessageToSend memory message = Messages.MessageToSend({
            params: params,
            sender: Messages.convertEVMAddressToGenericAddress(address(this)),
            destinationChainId: _hub.chainId,
            handler: _hub.contractAddress,
            payload: Messages.encodeMessagePayload(
                Messages.MessagePayload({
                    action: action,
                    accountId: accountId,
                    userAddress: Messages.convertEVMAddressToGenericAddress(msg.sender),
                    data: data
                })
            ),
            finalityLevel: 1, // finalised
            extraArgs: extraArgs
        });

        // send message
        _sendMessage(message, feeAmount);
    }

    /**
     * @notice Receive token from msg.sender into Spoke (or adapter if being bridged)
     * @param params The parameters for sending message to hub chain
     * @param amount The amount of token to receive
     * @return extraArgs needed when sending message and fee amount to use
     */
    function _receiveToken(
        Messages.MessageParams memory params,
        uint256 amount
    ) internal virtual returns (bytes memory extraArgs, uint256 feeAmount);

    /**
     * @notice Send token from Spoke to recipient
     * @param recipient The token recipient
     * @param amount The amount of token to send
     */
    function _sendToken(address recipient, uint256 amount) internal virtual;

    function _receiveMessage(Messages.MessageReceived memory message) internal override {
        Messages.MessagePayload memory payload = Messages.decodeActionPayload(message.payload);

        // ensure message sender is recognised
        bool isHub = message.sourceChainId == _hub.chainId && message.sourceAddress == _hub.contractAddress;
        if (!isHub) revert HubUnknown(message.sourceChainId, message.sourceAddress);

        // switch on payload action
        uint256 index = 0;
        if (payload.action == Messages.Action.SendToken) {
            address recipient = Messages.convertGenericAddressToEVMAddress(payload.userAddress);
            uint256 amount = payload.data.toUint256(index);

            // ensure capacity is sufficient, and if so, send token to user
            _decreaseCapacity(amount);
            _sendToken(recipient, amount);
        } else {
            revert CannotReceiveMessage(message.messageId);
        }
    }

    function _reverseMessage(Messages.MessageReceived memory message, bytes memory) internal pure override {
        revert CannotReverseMessage(message.messageId);
    }
}
