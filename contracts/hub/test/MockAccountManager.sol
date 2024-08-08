// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "../interfaces/IAccountManager.sol";

contract MockAccountManager is IAccountManager {
    event UnregisterAddress(bytes32 accountId, uint16 unregisterChainId);

    bytes32 public constant override HUB_ROLE = keccak256("HUB");

    bytes32 private _accountIdOfAddressOnChain;
    bytes32 private _addressRegisteredToAccountOnChain;
    bytes32 private _addressInvitedToAccountOnChain;
    bool private _isAccountCreated = true;
    bool private _isAddressInvitedToAccount = true;
    bool private _isAddressRegisteredToAccount = true;
    bool private _isDelegate = true;

    function createAccount(bytes32 accountId, uint16 chainId, bytes32 addr, bytes32 refAccountId) external override {
        emit CreateAccount(accountId, chainId, addr, refAccountId);
    }

    function inviteAddress(
        bytes32 accountId,
        uint16 inviteeChainId,
        bytes32 inviteeAddr,
        bytes32 refAccountId
    ) external override {
        emit InviteAddress(accountId, inviteeChainId, inviteeAddr, refAccountId);
    }

    function acceptInviteAddress(bytes32 accountId, uint16 chainId, bytes32 addr) external override {
        emit AcceptInviteAddress(accountId, chainId, addr);
    }

    function unregisterAddress(bytes32 accountId, uint16 unregisterChainId) external override {
        emit UnregisterAddress(accountId, unregisterChainId);
    }

    function addDelegate(bytes32 accountId, address addr) external override {
        emit AddDelegate(accountId, addr);
    }

    function removeDelegate(bytes32 accountId, address addr) external override {
        emit RemoveDelegate(accountId, addr);
    }

    function setAccountIdOfAddressOnChain(bytes32 newAccountIdOfAddressOnChain) external {
        _accountIdOfAddressOnChain = newAccountIdOfAddressOnChain;
    }

    function setAddressRegisteredToAccountOnChain(bytes32 newAddressRegisteredToAccountOnChain) external {
        _addressRegisteredToAccountOnChain = newAddressRegisteredToAccountOnChain;
    }

    function setIsAddressRegisteredToAccount(bool newIsAddressRegisteredToAccount) external {
        _isAddressRegisteredToAccount = newIsAddressRegisteredToAccount;
    }

    function setIsDelegate(bool newIsDelegate) external {
        _isDelegate = newIsDelegate;
    }

    function getNumAddressesRegisteredToAccount(bytes32) external view override returns (uint16) {
        return _isAddressRegisteredToAccount ? 1 : 0;
    }

    function getAccountIdOfAddressOnChain(bytes32, uint16) external view override returns (bytes32) {
        return _accountIdOfAddressOnChain;
    }

    function getAddressRegisteredToAccountOnChain(bytes32, uint16) external view override returns (bytes32) {
        return _addressRegisteredToAccountOnChain;
    }

    function getAddressInvitedToAccountOnChain(bytes32, uint16) external view override returns (bytes32) {
        return _addressInvitedToAccountOnChain;
    }

    function isAccountCreated(bytes32) public view override returns (bool) {
        return _isAccountCreated;
    }

    function isAddressRegistered(uint16, bytes32) public view override returns (bool) {
        return _accountIdOfAddressOnChain != bytes32(0);
    }

    function isAddressInvitedToAccount(bytes32, uint16, bytes32) public view override returns (bool) {
        return _isAddressInvitedToAccount;
    }

    function isAddressRegisteredToAccount(bytes32, uint16, bytes32) public view override returns (bool) {
        return _isAddressRegisteredToAccount;
    }

    function isDelegate(bytes32, address) public view override returns (bool) {
        return _isDelegate;
    }
}
