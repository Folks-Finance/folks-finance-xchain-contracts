// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "./BridgeMessenger.sol";
import "./interfaces/IBridgeAdapter.sol";
import "./interfaces/IBridgeRouter.sol";
import "./libraries/Messages.sol";

abstract contract BridgeRouter is IBridgeRouter, AccessControlDefaultAdminRules {
    bytes32 public constant override MANAGER_ROLE = keccak256("MANAGER");
    bytes32 public constant override MESSAGE_SENDER_ROLE = keccak256("MESSAGE_SENDER");

    event MessageSucceeded(uint16 adapterId, bytes32 indexed messageId);
    event MessageFailed(uint16 adapterId, bytes32 indexed messageId, bytes reason);
    event MessageRetrySucceeded(uint16 adapterId, bytes32 indexed messageId);
    event MessageRetryFailed(uint16 adapterId, bytes32 indexed messageId, bytes reason);
    event MessageReverseSucceeded(uint16 adapterId, bytes32 indexed messageId);
    event MessageReverseFailed(uint16 adapterId, bytes32 indexed messageId, bytes reason);
    event Withdraw(bytes32 userId, address receiver, uint256 amount);

    error NotEnoughFunds(bytes32 user);
    error FailedToWithdrawFunds(address recipient, uint256 amount);
    error ChainUnavailable(uint16 folksChainId);
    error SenderDoesNotMatch(address messager, address caller);
    error AdapterInitialized(uint16 adapterId);
    error AdapterNotInitialized(uint16 adapterId);
    error AdapterUnknown(IBridgeAdapter adapter);
    error MessageAlreadySeen(bytes32 messageId);
    error MessageUnknown(bytes32 messageId);

    mapping(uint16 adapterId => IBridgeAdapter adapter) public idToAdapter;
    mapping(IBridgeAdapter adapter => uint16 adapterId) public adapterToId;

    mapping(uint16 adapterId => mapping(bytes32 messageId => bool hasBeenSeen)) public seenMessages;
    mapping(uint16 adapterId => mapping(bytes32 messageId => Messages.MessageReceived)) public failedMessages;
    mapping(bytes32 userId => uint256 balance) public balances;

    constructor(address admin) AccessControlDefaultAdminRules(1 days, admin) {
        _grantRole(MANAGER_ROLE, admin);
    }

    function addAdapter(uint16 adapterId, IBridgeAdapter adapter) external onlyRole(MANAGER_ROLE) {
        // check if no existing adapter
        if (isAdapterInitialized(adapterId)) revert AdapterInitialized(adapterId);

        // add adapter
        idToAdapter[adapterId] = adapter;
        adapterToId[adapter] = adapterId;
    }

    function removeAdapter(uint16 adapterId) external onlyRole(MANAGER_ROLE) {
        // check if valid adapter and retrieve
        IBridgeAdapter adapter = getAdapter(adapterId);

        // remove adapter
        delete idToAdapter[adapterId];
        delete adapterToId[adapter];
    }

    function getSendFee(Messages.MessageToSend memory message) external view override returns (uint256) {
        // check if valid adapter and retrieve
        IBridgeAdapter adapter = getAdapter(message.params.adapterId);

        // call given adapter to get fee
        return adapter.getSendFee(message);
    }

    function sendMessage(
        Messages.MessageToSend memory message
    ) external payable override onlyRole(MESSAGE_SENDER_ROLE) {
        // check if valid adapter and retrieve
        IBridgeAdapter adapter = getAdapter(message.params.adapterId);

        // check if messager matches caller
        address messager = Messages.convertGenericAddressToEVMAddress(message.sender);
        if (messager != msg.sender) revert SenderDoesNotMatch(messager, msg.sender);

        // call given adapter to get fee
        uint256 fee = adapter.getSendFee(message);

        // check if have sufficient funds to pay fee (can come from existing balance and/or msg.value)
        bytes32 userId = _getUserId(Messages.decodeActionPayload(message.payload));
        uint256 userBalance = balances[userId];
        if (msg.value + userBalance < fee) revert NotEnoughFunds(userId);

        // update user balance considering fee and msg.value
        balances[userId] = userBalance + msg.value - fee;

        // call given adapter to send message
        adapter.sendMessage{ value: fee }(message);
    }

    function receiveMessage(Messages.MessageReceived memory message) external payable override {
        // check if caller is valid adapter
        IBridgeAdapter adapter = IBridgeAdapter(msg.sender);
        uint16 adapterId = adapterToId[adapter];
        if (!isAdapterInitialized(adapterId)) revert AdapterUnknown(adapter);

        // check if haven't seen message
        if (seenMessages[adapterId][message.messageId]) revert MessageAlreadySeen(message.messageId);

        // convert handler to address type (from lower 20 bytes)
        address handler = Messages.convertGenericAddressToEVMAddress(message.handler);

        // add msg.value to user balance if present
        if (msg.value > 0) {
            bytes32 userId = _getUserId(Messages.decodeActionPayload(message.payload));
            balances[userId] += msg.value;
        }

        // store message as seen before call to handler
        seenMessages[adapterId][message.messageId] = true;

        // call handler with received payload
        try BridgeMessenger(handler).receiveMessage(message) {
            // emit message received as suceeded
            emit MessageSucceeded(adapterId, message.messageId);
        } catch (bytes memory err) {
            // don't revert so GMP doesn't revert
            // store and emit message received as failed
            failedMessages[adapterId][message.messageId] = message;
            emit MessageFailed(adapterId, message.messageId, err);
        }
    }

    function retryMessage(uint16 adapterId, bytes32 messageId) external payable {
        // get failed message if known
        Messages.MessageReceived memory message = _getFailedMessage(adapterId, messageId);

        // convert handler to address type (from lower 20 bytes)
        address handler = Messages.convertGenericAddressToEVMAddress(message.handler);

        // add msg.value to user balance if present
        if (msg.value > 0) {
            bytes32 userId = _getUserId(Messages.decodeActionPayload(message.payload));
            balances[userId] += msg.value;
        }

        // clear failure before call to handler
        delete failedMessages[adapterId][message.messageId];

        // call handler with received payload
        try BridgeMessenger(handler).receiveMessage(message) {
            // emit message retry as suceeded
            emit MessageRetrySucceeded(adapterId, message.messageId);
        } catch (bytes memory err) {
            // store and emit message retry as failed
            failedMessages[adapterId][message.messageId] = message;
            emit MessageRetryFailed(adapterId, message.messageId, err);
        }
    }

    function reverseMessage(uint16 adapterId, bytes32 messageId, bytes memory extraArgs) external payable {
        // get failed message if known
        Messages.MessageReceived memory message = _getFailedMessage(adapterId, messageId);

        // convert handler to address type (from lower 20 bytes)
        address handler = Messages.convertGenericAddressToEVMAddress(message.handler);

        // add msg.value to user balance if present
        if (msg.value > 0) {
            bytes32 userId = _getUserId(Messages.decodeActionPayload(message.payload));
            balances[userId] += msg.value;
        }

        // clear failure before call to handler
        delete failedMessages[adapterId][message.messageId];

        // call handler with received payload
        try BridgeMessenger(handler).reverseMessage(message, extraArgs) {
            // clear failure and emit message reverse as suceeded
            emit MessageReverseSucceeded(adapterId, message.messageId);
        } catch (bytes memory err) {
            // store and emit message reverse as failed
            failedMessages[adapterId][message.messageId] = message;
            emit MessageReverseFailed(adapterId, message.messageId, err);
        }
    }

    function increaseBalance(bytes32 userId) external payable {
        balances[userId] += msg.value;
    }

    function isAdapterInitialized(uint16 adapterId) public view returns (bool) {
        IBridgeAdapter adapter = idToAdapter[adapterId];
        return (address(adapter) != address(0x0));
    }

    function getAdapter(uint16 adapterId) public view returns (IBridgeAdapter) {
        if (!isAdapterInitialized(adapterId)) revert AdapterNotInitialized(adapterId);
        return idToAdapter[adapterId];
    }

    function _getFailedMessage(
        uint16 adapterId,
        bytes32 messageId
    ) internal view returns (Messages.MessageReceived memory) {
        Messages.MessageReceived memory message = failedMessages[adapterId][messageId];
        if (!seenMessages[adapterId][messageId] || message.messageId != messageId) revert MessageUnknown(messageId);
        return message;
    }

    function _getUserId(Messages.MessagePayload memory payload) internal view virtual returns (bytes32);
}
