// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@solidity-bytes-utils/contracts/BytesLib.sol";

import "../bridge/BridgeMessenger.sol";
import "../bridge/libraries/Messages.sol";
import "./interfaces/IAccountManager.sol";
import "./interfaces/IHubPool.sol";
import "./interfaces/ILoanManager.sol";
import "./interfaces/ISpokeManager.sol";

/**
 * @title Hub
 * @author Folks Finance
 * @notice Main contract of Hub
 */
contract Hub is BridgeMessenger {
    using BytesLib for bytes;

    struct ReceiveToken {
        uint8 poolId;
        uint256 amount;
    }

    struct SendToken {
        uint8 poolId;
        uint16 chainId;
        uint256 amount;
    }

    error SpokeUnknown(uint16 chainId, bytes32 addr);
    error InvalidTokenFeeClaimer(address expected, address actual);
    error UnsupportedDirectOperation(Messages.Action action);

    ISpokeManager public immutable spokeManager;
    IAccountManager public immutable accountManager;
    ILoanManager public immutable loanManager;
    uint16 public immutable hubChainId;

    constructor(
        IBridgeRouter bridgeRouter,
        ISpokeManager spokeManager_,
        IAccountManager accountManager_,
        ILoanManager loanManager_,
        uint16 hubChainId_
    ) BridgeMessenger(bridgeRouter) {
        spokeManager = spokeManager_;
        accountManager = accountManager_;
        loanManager = loanManager_;
        hubChainId = hubChainId_;
    }

    function claimTokenFees(
        uint8 poolId,
        uint16 chainId,
        uint16 returnAdapterId,
        uint256 returnGasLimit
    ) external nonReentrant {
        IHubPool pool = loanManager.getPool(poolId);

        // check claimer
        address tokenFeeClaimer = pool.getTokenFeeClaimer();
        if (msg.sender != tokenFeeClaimer) revert InvalidTokenFeeClaimer(tokenFeeClaimer, msg.sender);

        // get amount to claim and clear
        uint256 amount = pool.clearTokenFees();

        // send fees to designiated recipient
        bytes32 recipient = pool.getTokenFeeRecipient();
        sendTokenToUser(
            returnAdapterId,
            returnGasLimit,
            bytes32(0),
            recipient,
            SendToken({ poolId: poolId, chainId: chainId, amount: amount })
        );
    }

    function directOperation(Messages.Action action, bytes32 accountId, bytes memory data) external nonReentrant {
        // check sender has permission for relevant operations
        bool isRegistered = accountManager.isAddressRegisteredToAccount(
            accountId,
            hubChainId,
            Messages.convertEVMAddressToGenericAddress(msg.sender)
        );
        bool isDelegate = accountManager.isDelegate(accountId, msg.sender);
        if (!(isRegistered || isDelegate)) revert IAccountManager.NoPermissionOnHub(accountId, msg.sender);

        // switch on payload action
        uint256 index = 0;
        if (action == Messages.Action.DepositFToken) {
            bytes32 loanId = data.toBytes32(index);
            index += 32;
            uint8 poolId = data.toUint8(index);
            index += 1;
            uint256 fAmount = data.toUint256(index);

            loanManager.depositFToken(loanId, accountId, poolId, msg.sender, fAmount);
        } else if (action == Messages.Action.WithdrawFToken) {
            bytes32 loanId = data.toBytes32(index);
            index += 32;
            uint8 poolId = data.toUint8(index);
            index += 1;
            uint256 fAmount = data.toUint256(index);

            loanManager.withdrawFToken(loanId, accountId, poolId, msg.sender, fAmount);
        } else if (action == Messages.Action.Liquidate) {
            bytes32 violatorLoanId = data.toBytes32(index);
            index += 32;
            bytes32 liquidatorLoanId = data.toBytes32(index);
            index += 32;
            uint8 colPoolId = data.toUint8(index);
            index += 1;
            uint8 borPoolId = data.toUint8(index);
            index += 1;
            uint256 repayingAmount = data.toUint256(index);
            index += 32;
            uint256 minSeizedAmount = data.toUint256(index);
            index += 32;

            loanManager.liquidate(
                violatorLoanId,
                liquidatorLoanId,
                accountId,
                colPoolId,
                borPoolId,
                repayingAmount,
                minSeizedAmount
            );
        } else {
            revert UnsupportedDirectOperation(action);
        }
    }

    function _receiveMessage(Messages.MessageReceived memory message) internal override {
        Messages.MessagePayload memory payload = Messages.decodeActionPayload(message.payload);
        ReceiveToken memory receiveToken;
        SendToken memory sendToken;

        // ensure message sender is recognised
        bool isSpoke = spokeManager.isSpoke(message.sourceChainId, message.sourceAddress);
        if (!isSpoke) revert SpokeUnknown(message.sourceChainId, message.sourceAddress);

        // check sender has permission for relevant operations
        bool isRegistered = accountManager.isAddressRegisteredToAccount(
            payload.accountId,
            message.sourceChainId,
            payload.userAddress
        );
        if (
            payload.action != Messages.Action.CreateAccount &&
            payload.action != Messages.Action.AcceptInviteAddress &&
            !isRegistered
        ) revert IAccountManager.NotRegisteredToAccount(payload.accountId, message.sourceChainId, payload.userAddress);

        // switch on payload action
        uint256 index = 0;
        if (payload.action == Messages.Action.CreateAccount) {
            bytes32 refAccountId = payload.data.toBytes32(index);

            accountManager.createAccount(payload.accountId, message.sourceChainId, payload.userAddress, refAccountId);
        } else if (payload.action == Messages.Action.InviteAddress) {
            uint16 inviteeChainId = payload.data.toUint16(index);
            index += 2;
            bytes32 inviteeAddr = payload.data.toBytes32(index);
            index += 32;
            bytes32 refAccountId = payload.data.toBytes32(index);

            accountManager.inviteAddress(payload.accountId, inviteeChainId, inviteeAddr, refAccountId);
        } else if (payload.action == Messages.Action.AcceptInviteAddress) {
            accountManager.acceptInviteAddress(payload.accountId, message.sourceChainId, payload.userAddress);
        } else if (payload.action == Messages.Action.UnregisterAddress) {
            uint16 unregisterChainId = payload.data.toUint16(index);

            accountManager.unregisterAddress(payload.accountId, unregisterChainId);
        } else if (payload.action == Messages.Action.AddDelegate) {
            address delegateAddr = Messages.convertGenericAddressToEVMAddress(payload.data.toBytes32(index));

            accountManager.addDelegate(payload.accountId, delegateAddr);
        } else if (payload.action == Messages.Action.RemoveDelegate) {
            address delegateAddr = Messages.convertGenericAddressToEVMAddress(payload.data.toBytes32(index));

            accountManager.removeDelegate(payload.accountId, delegateAddr);
        } else if (payload.action == Messages.Action.CreateLoan) {
            bytes32 loanId = payload.data.toBytes32(index);
            index += 32;
            uint16 loanTypeId = payload.data.toUint16(index);
            index += 2;
            bytes32 loanName = payload.data.toBytes32(index);

            loanManager.createUserLoan(loanId, payload.accountId, loanTypeId, loanName);
        } else if (payload.action == Messages.Action.DeleteLoan) {
            bytes32 loanId = payload.data.toBytes32(index);

            loanManager.deleteUserLoan(loanId, payload.accountId);
        } else if (payload.action == Messages.Action.CreateLoanAndDeposit) {
            bytes32 loanId = payload.data.toBytes32(index);
            index += 32;
            uint8 poolId = payload.data.toUint8(index);
            index += 1;
            uint256 amount = payload.data.toUint256(index);
            index += 32;
            uint16 loanTypeId = payload.data.toUint16(index);
            index += 2;
            bytes32 loanName = payload.data.toBytes32(index);

            loanManager.createUserLoan(loanId, payload.accountId, loanTypeId, loanName);
            loanManager.deposit(loanId, payload.accountId, poolId, amount);

            // save token received
            receiveToken = ReceiveToken({ poolId: poolId, amount: amount });
        } else if (payload.action == Messages.Action.Deposit) {
            bytes32 loanId = payload.data.toBytes32(index);
            index += 32;
            uint8 poolId = payload.data.toUint8(index);
            index += 1;
            uint256 amount = payload.data.toUint256(index);

            loanManager.deposit(loanId, payload.accountId, poolId, amount);

            // save token received
            receiveToken = ReceiveToken({ poolId: poolId, amount: amount });
        } else if (payload.action == Messages.Action.Withdraw) {
            bytes32 loanId = payload.data.toBytes32(index);
            index += 32;
            uint8 poolId = payload.data.toUint8(index);
            index += 1;
            uint16 chainId = payload.data.toUint16(index);
            index += 2;
            uint256 amount = payload.data.toUint256(index);
            index += 32;
            bool isFAmount = payload.data.toUint8(index) > 0;

            // override amount in case isFAmount is true
            amount = loanManager.withdraw(loanId, payload.accountId, poolId, amount, isFAmount);

            // save token to be sent
            sendToken = SendToken({ poolId: poolId, chainId: chainId, amount: amount });
        } else if (payload.action == Messages.Action.Borrow) {
            bytes32 loanId = payload.data.toBytes32(index);
            index += 32;
            uint8 poolId = payload.data.toUint8(index);
            index += 1;
            uint16 chainId = payload.data.toUint16(index);
            index += 2;
            uint256 amount = payload.data.toUint256(index);
            index += 32;
            uint256 maxStableRate = payload.data.toUint256(index);

            loanManager.borrow(loanId, payload.accountId, poolId, amount, maxStableRate);

            // save token to be sent
            sendToken = SendToken({ poolId: poolId, chainId: chainId, amount: amount });
        } else if (payload.action == Messages.Action.Repay) {
            bytes32 loanId = payload.data.toBytes32(index);
            index += 32;
            uint8 poolId = payload.data.toUint8(index);
            index += 1;
            uint256 amount = payload.data.toUint256(index);
            index += 32;
            uint256 maxOverRepayment = payload.data.toUint256(index);

            loanManager.repay(loanId, payload.accountId, poolId, amount, maxOverRepayment);

            // save token received
            receiveToken = ReceiveToken({ poolId: poolId, amount: amount });
        } else if (payload.action == Messages.Action.RepayWithCollateral) {
            bytes32 loanId = payload.data.toBytes32(index);
            index += 32;
            uint8 poolId = payload.data.toUint8(index);
            index += 1;
            uint256 amount = payload.data.toUint256(index);

            loanManager.repayWithCollateral(loanId, payload.accountId, poolId, amount);
        } else if (payload.action == Messages.Action.SwitchBorrowType) {
            bytes32 loanId = payload.data.toBytes32(index);
            index += 32;
            uint8 poolId = payload.data.toUint8(index);
            index += 1;
            uint256 maxStableRate = payload.data.toUint256(index);

            loanManager.switchBorrowType(loanId, payload.accountId, poolId, maxStableRate);
        } else {
            revert CannotReceiveMessage(message.messageId);
        }

        // (if applicable) verify token received
        if (receiveToken.amount > 0)
            verifyTokenReceivedFromUser(message.sourceChainId, message.sourceAddress, receiveToken);

        // (if applicable) send token to user
        if (sendToken.amount > 0) {
            bytes32 recipient = accountManager.getAddressRegisteredToAccountOnChain(
                payload.accountId,
                sendToken.chainId
            );
            sendTokenToUser(message.returnAdapterId, message.returnGasLimit, payload.accountId, recipient, sendToken);
        }
    }

    function _reverseMessage(Messages.MessageReceived memory message, bytes memory extraArgs) internal override {
        Messages.MessagePayload memory payload = Messages.decodeActionPayload(message.payload);

        // check sender has permission for relevant operations, overriding account id if neccessary
        bytes32 accountId = extraArgs.length == 0 ? payload.accountId : extraArgs.toBytes32(0);
        bool isRegistered = accountManager.isAddressRegisteredToAccount(
            accountId,
            message.sourceChainId,
            payload.userAddress
        );
        if (!isRegistered)
            revert IAccountManager.NotRegisteredToAccount(accountId, message.sourceChainId, payload.userAddress);

        // only can reverse (create loan and) deposit or repay
        if (
            !(payload.action == Messages.Action.CreateLoanAndDeposit ||
                payload.action == Messages.Action.Deposit ||
                payload.action == Messages.Action.Repay)
        ) revert CannotReverseMessage(message.messageId);

        // (create loan and) deposit/repay payload [loanId (ignored), poolId, amount, ...]
        uint256 index = 32;
        uint8 poolId = payload.data.toUint8(index);
        index += 1;
        uint256 amount = payload.data.toUint256(index);

        // verify token was received and if so, send it back to user
        verifyTokenReceivedFromUser(
            message.sourceChainId,
            message.sourceAddress,
            ReceiveToken({ poolId: poolId, amount: amount })
        );
        sendTokenToUser(
            message.returnAdapterId,
            message.returnGasLimit,
            accountId,
            payload.userAddress,
            SendToken({ poolId: poolId, chainId: message.sourceChainId, amount: amount })
        );
    }

    function verifyTokenReceivedFromUser(
        uint16 chainId,
        bytes32 source,
        ReceiveToken memory receiveToken
    ) internal view {
        // ensure token was received (by checking if source is trusted spoke)
        IHubPool pool = loanManager.getPool(receiveToken.poolId);
        pool.verifyReceiveToken(chainId, source);
    }

    function sendTokenToUser(
        uint16 adapterId,
        uint256 gasLimit,
        bytes32 accountId,
        bytes32 recipient,
        SendToken memory sendToken
    ) internal {
        // generate message to send token
        IHubPool pool = loanManager.getPool(sendToken.poolId);
        Messages.MessageToSend memory messageToSend = pool.getSendTokenMessage(
            bridgeRouter,
            adapterId,
            gasLimit,
            accountId,
            sendToken.chainId,
            sendToken.amount,
            recipient
        );

        // send message (balance for user account already present in bridge router)
        _sendMessage(messageToSend, 0);
    }
}
