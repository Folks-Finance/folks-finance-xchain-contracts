// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "../bridge/BridgeMessenger.sol";
import "../bridge/interfaces/IBridgeRouter.sol";
import "../bridge/libraries/Messages.sol";
import "./interfaces/IAddressOracle.sol";
import "./SpokeState.sol";

contract SpokeCommon is BridgeMessenger, SpokeState {
    constructor(
        address admin,
        IBridgeRouter bridgeRouter,
        uint16 hubChainId,
        bytes32 hubContractAddress,
        IAddressOracle addressOracle
    ) BridgeMessenger(bridgeRouter) SpokeState(admin, hubChainId, hubContractAddress, addressOracle) {}

    /**
     * @notice Create account
     * @param params The parameters for sending message to hub chain
     * @param accountId  account id to create
     * @param nonce The nonce used to generate the account id
     * @param refAccountId The account id referrer (use zero bytes if no referrer)
     */
    function createAccount(
        Messages.MessageParams memory params,
        bytes32 accountId,
        bytes4 nonce,
        bytes32 refAccountId
    ) external payable nonReentrant {
        _doOperation(params, Messages.Action.CreateAccount, accountId, abi.encodePacked(nonce, refAccountId));
    }

    /**
     * @notice Invite an address of the specified chain to account
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id to invite the address to
     * @param chainId The chain id of the address to be invited
     * @param addr The address to invite
     * @param refAccountId The account id referrer (use zero bytes if no referrer)
     */
    function inviteAddress(
        Messages.MessageParams memory params,
        bytes32 accountId,
        uint16 chainId,
        bytes32 addr,
        bytes32 refAccountId
    ) external payable nonReentrant {
        _doOperation(params, Messages.Action.InviteAddress, accountId, abi.encodePacked(chainId, addr, refAccountId));
    }

    /**
     * @notice Accept invite to account (must be sent from chain-address pair accepting the invite)
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id invited to
     */
    function acceptInviteAddress(
        Messages.MessageParams memory params,
        bytes32 accountId
    ) external payable nonReentrant {
        _doOperation(params, Messages.Action.AcceptInviteAddress, accountId, "");
    }

    /**
     * @notice Remove (or uninvite) an address of the specified chain from account
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id to unregister the address from
     * @param chainId The chain id of the address to unregister
     */
    function unregisterAddress(
        Messages.MessageParams memory params,
        bytes32 accountId,
        uint16 chainId
    ) external payable nonReentrant {
        _doOperation(params, Messages.Action.UnregisterAddress, accountId, abi.encodePacked(chainId));
    }

    /**
     * @notice Delegate to address on hub chain to perform operations on account
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id to add the delegate to
     * @param addr The delegate address
     */
    function addDelegate(
        Messages.MessageParams memory params,
        bytes32 accountId,
        bytes32 addr
    ) external payable nonReentrant {
        _doOperation(params, Messages.Action.AddDelegate, accountId, abi.encodePacked(addr));
    }

    /**
     * @notice Remove delegate to address on hub chain to perform operations on account
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id to remove the delegate from
     * @param addr The delegate address
     */
    function removeDelegate(
        Messages.MessageParams memory params,
        bytes32 accountId,
        bytes32 addr
    ) external payable nonReentrant {
        _doOperation(params, Messages.Action.RemoveDelegate, accountId, abi.encodePacked(addr));
    }

    /**
     * @notice Create loan (alternative is to use "create loan and deposit" method)
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id to create the loan in
     * @param nonce The nonce used to generate the loan id
     * @param loanTypeId The load type to create
     * @param loanName The loan name to help identify the loan to user
     */
    function createLoan(
        Messages.MessageParams memory params,
        bytes32 accountId,
        bytes4 nonce,
        uint16 loanTypeId,
        bytes32 loanName
    ) external payable nonReentrant {
        _doOperation(params, Messages.Action.CreateLoan, accountId, abi.encodePacked(nonce, loanTypeId, loanName));
    }

    /**
     * @notice Delete loan
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id of the loan to delete
     * @param loanId The load id to delete
     */
    function deleteLoan(
        Messages.MessageParams memory params,
        bytes32 accountId,
        bytes32 loanId
    ) external payable nonReentrant {
        _doOperation(params, Messages.Action.DeleteLoan, accountId, abi.encodePacked(loanId));
    }

    /**
     * @notice Withdraw token to registered address of specified chain
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id of the loan
     * @param loanId The loan id to withdraw from
     * @param poolId The pool id for the token to withdraw
     * @param chainId The chain id to receive the funds on (must be compatible with token)
     * @param amount The amount to withdraw
     * @param isFAmount Whether the amount is denominated in the f token or underlying token
     */
    function withdraw(
        Messages.MessageParams memory params,
        bytes32 accountId,
        bytes32 loanId,
        uint8 poolId,
        uint16 chainId,
        uint256 amount,
        bool isFAmount
    ) external payable nonReentrant {
        _doOperation(
            params,
            Messages.Action.Withdraw,
            accountId,
            abi.encodePacked(loanId, poolId, chainId, amount, isFAmount)
        );
    }

    /**
     * @notice Borrow token to registered address of specified chain
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id of the loan
     * @param loanId The loan id to borrow using
     * @param poolId The pool id for the token to borrow
     * @param chainId The chain id to receive the funds on (must be compatible with token)
     * @param amount The amount to borrow
     * @param maxStableRate The max stable rate - if zero then is interpreted as variable borrow
     */
    function borrow(
        Messages.MessageParams memory params,
        bytes32 accountId,
        bytes32 loanId,
        uint8 poolId,
        uint16 chainId,
        uint256 amount,
        uint256 maxStableRate
    ) external payable nonReentrant {
        _doOperation(
            params,
            Messages.Action.Borrow,
            accountId,
            abi.encodePacked(loanId, poolId, chainId, amount, maxStableRate)
        );
    }

    /**
     * @notice Repay borrow in specified loan using existing collateral
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id of the loan
     * @param loanId The loan id to repay in
     * @param poolId The pool id for the token to repay
     * @param amount The amount to repay
     */
    function repayWithCollateral(
        Messages.MessageParams memory params,
        bytes32 accountId,
        bytes32 loanId,
        uint8 poolId,
        uint256 amount
    ) external payable nonReentrant {
        _doOperation(params, Messages.Action.RepayWithCollateral, accountId, abi.encodePacked(loanId, poolId, amount));
    }

    /**
     * @notice Switch borrow type of specified borrow
     * @param params The parameters for sending message to hub chain
     * @param accountId The account id of the loan
     * @param loanId The loan id the borrow is on
     * @param poolId The pool id the borrow is on
     * @param maxStableRate The max stable rate - if zero then interpreted as switching a stable to variable borrow
     */
    function switchBorrowType(
        Messages.MessageParams memory params,
        bytes32 accountId,
        bytes32 loanId,
        uint8 poolId,
        uint256 maxStableRate
    ) external payable nonReentrant {
        _doOperation(
            params,
            Messages.Action.SwitchBorrowType,
            accountId,
            abi.encodePacked(loanId, poolId, maxStableRate)
        );
    }

    function _doOperation(
        Messages.MessageParams memory params,
        Messages.Action action,
        bytes32 accountId,
        bytes memory data
    ) internal {
        // check sender is eligible to do given action
        if (!_addressOracle.isEligible(msg.sender, uint16(action)))
            revert IAddressOracle.AddressIneligible(msg.sender, uint16(action));

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
            finalityLevel: 0, // immediate
            extraArgs: ""
        });

        // send message
        _sendMessage(message, msg.value);
    }

    function _receiveMessage(Messages.MessageReceived memory message) internal pure override {
        revert CannotReceiveMessage(message.messageId);
    }

    function _reverseMessage(Messages.MessageReceived memory message, bytes memory) internal pure override {
        revert CannotReverseMessage(message.messageId);
    }
}
