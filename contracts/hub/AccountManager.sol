// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "./interfaces/IAccountManager.sol";

contract AccountManager is IAccountManager, AccessControlDefaultAdminRules {
    bytes32 public constant override HUB_ROLE = keccak256("HUB");

    /// @notice Mapping of accounts to the number of addresses registered to them
    mapping(bytes32 accountId => uint16 numAddresses) internal accounts;

    /// @notice Mapping of account to addresses on spoke chains which will/are/have been able to manage the account
    mapping(bytes32 accountId => mapping(uint16 chainId => AccountAddress)) internal accountAddresses;

    /// @notice Mapping of addresses on spoke chains to the accountId they are registered to
    mapping(bytes32 addr => mapping(uint16 chainId => bytes32 accountId)) internal registeredAddresses;

    /// @notice Mapping of account to addresses on hub chain which are permitted to manage the account
    mapping(bytes32 accountId => mapping(address => bool isDelegated)) internal accountDelegatedAddresses;

    /**
     * @notice Constructor
     * @param admin The default admin for AccountManager
     */
    constructor(address admin) AccessControlDefaultAdminRules(1 days, admin) {}

    /**
     * @notice Create account
     * @param accountId The account id to create
     * @param chainId The chain id of the sender
     * @param addr The address of the sender
     * @param refAccountId The referrer account id (zero bytes if no referrer)
     */
    function createAccount(
        bytes32 accountId,
        uint16 chainId,
        bytes32 addr,
        bytes32 refAccountId
    ) external override onlyRole(HUB_ROLE) {
        // check account is not already created (empty is reserved for admin)
        if (isAccountCreated(accountId) || accountId == bytes32(0)) revert AccountAlreadyCreated(accountId);

        // check address is not already registered
        if (isAddressRegistered(chainId, addr)) revert AddressPreviouslyRegistered(chainId, addr);

        // check referrer is well defined
        if (!(isAccountCreated(refAccountId) || refAccountId == bytes32(0)))
            revert InvalidReferrerAccount(refAccountId);

        // create account
        accounts[accountId] = 1;
        accountAddresses[accountId][chainId] = AccountAddress({ addr: addr, invited: false, registered: true });
        registeredAddresses[addr][chainId] = accountId;

        emit CreateAccount(accountId, chainId, addr, refAccountId);
    }

    /**
     * @notice Invite address to account
     * @param accountId The account id to invite the address to
     * @param inviteeChainId The chain id of the address to invite
     * @param inviteeAddr The address to invite
     * @param refAccountId The referrer account id (zero bytes if no referrer)
     */
    function inviteAddress(
        bytes32 accountId,
        uint16 inviteeChainId,
        bytes32 inviteeAddr,
        bytes32 refAccountId
    ) external override onlyRole(HUB_ROLE) {
        // check account created and invitee not already registered
        if (!isAccountCreated(accountId)) revert UnknownAccount(accountId);
        if (isAddressRegistered(inviteeChainId, inviteeAddr))
            revert AddressPreviouslyRegistered(inviteeChainId, inviteeAddr);

        // check account does not have address registered
        if (accountAddresses[accountId][inviteeChainId].registered)
            revert AccountHasAddressRegistered(accountId, inviteeChainId);

        // check referrer is well defined
        if (!(isAccountCreated(refAccountId) || refAccountId == bytes32(0)) || accountId == refAccountId)
            revert InvalidReferrerAccount(refAccountId);

        // invite address (possibly overriding existing invite)
        accountAddresses[accountId][inviteeChainId] = AccountAddress({
            addr: inviteeAddr,
            invited: true,
            registered: false
        });

        emit InviteAddress(accountId, inviteeChainId, inviteeAddr, refAccountId);
    }

    /**
     * @notice Accept invite to account
     * @param accountId The account id to invite the address to
     * @param chainId The chain id of the sender
     * @param addr The address of the sender
     */
    function acceptInviteAddress(bytes32 accountId, uint16 chainId, bytes32 addr) external override onlyRole(HUB_ROLE) {
        // check account created and not already registered
        if (!isAccountCreated(accountId)) revert UnknownAccount(accountId);
        if (isAddressRegistered(chainId, addr)) revert AddressPreviouslyRegistered(chainId, addr);

        // check if invited
        if (!isAddressInvitedToAccount(accountId, chainId, addr)) revert NotInvitedToAccount(accountId, chainId, addr);

        // accept and register
        accounts[accountId] += 1;
        AccountAddress storage accountAddress = accountAddresses[accountId][chainId];
        accountAddress.invited = false;
        accountAddress.registered = true;
        registeredAddresses[addr][chainId] = accountId;

        emit AcceptInviteAddress(accountId, chainId, addr);
    }

    /**
     * @notice Remove (or uninvite) an address of the specified chain from account
     * @param accountId The account id to invite the address to
     * @param unregisterChainId The chain id of the address to unregister
     */
    function unregisterAddress(bytes32 accountId, uint16 unregisterChainId) external override onlyRole(HUB_ROLE) {
        // check account created
        if (!isAccountCreated(accountId)) revert UnknownAccount(accountId);

        // check unregistee
        AccountAddress storage accountAddress = accountAddresses[accountId][unregisterChainId];
        if (!accountAddress.invited && !accountAddress.registered)
            revert NoAddressToUnregister(accountId, unregisterChainId);
        bytes32 unregisterAddr = accountAddress.addr;

        // remove address
        if (accountAddress.registered) {
            accounts[accountId] -= 1;
            delete registeredAddresses[unregisterAddr][unregisterChainId];

            // ensure you have at least one address registered
            if (!isAccountCreated(accountId)) revert CannotDeleteAccount(accountId);
        }
        accountAddress.invited = false;
        accountAddress.registered = false;

        emit UnregisterAddress(accountId, unregisterChainId, unregisterAddr);
    }

    /**
     * @notice Delegate to address on hub chain to perform operations on account
     * @param accountId The account id to add the delegate to
     * @param addr The delegate address
     */
    function addDelegate(bytes32 accountId, address addr) external override onlyRole(HUB_ROLE) {
        // check account created and not already delegate
        if (!isAccountCreated(accountId)) revert UnknownAccount(accountId);
        if (isDelegate(accountId, addr)) revert DelegateAlreadyAdded(accountId, addr);

        // add delegate
        accountDelegatedAddresses[accountId][addr] = true;

        emit AddDelegate(accountId, addr);
    }

    /**
     * @notice Remove delegate to address on hub chain to perform operations on account
     * @param accountId The account id to remove the delegate from
     * @param addr The delegate address
     */
    function removeDelegate(bytes32 accountId, address addr) external override onlyRole(HUB_ROLE) {
        // check account created and address is delegate
        if (!isAccountCreated(accountId)) revert UnknownAccount(accountId);
        if (!isDelegate(accountId, addr)) revert NoDelegateToRemove(accountId, addr);

        // remove delegate
        accountDelegatedAddresses[accountId][addr] = false;

        emit RemoveDelegate(accountId, addr);
    }

    /**
     * @notice Get number of addresses registered to an account
     * @param accountId The account id
     */
    function getNumAddressesRegisteredToAccount(bytes32 accountId) external view override returns (uint16) {
        return accounts[accountId];
    }

    /**
     * @notice Get account id of registered address on chain
     * @param addr The address to get the account id of
     * @param chainId The chain id
     */
    function getAccountIdOfAddressOnChain(bytes32 addr, uint16 chainId) external view override returns (bytes32) {
        if (!isAddressRegistered(chainId, addr)) revert NoAccountRegisteredTo(chainId, addr);
        return registeredAddresses[addr][chainId];
    }

    /**
     * @notice Remove delegate to address on hub chain to perform operations on account
     * @param accountId The account id to remove the delegate from
     * @param chainId The chain id
     */
    function getAddressRegisteredToAccountOnChain(
        bytes32 accountId,
        uint16 chainId
    ) external view override returns (bytes32) {
        if (!isAccountCreated(accountId)) revert UnknownAccount(accountId);
        AccountAddress memory accountAddress = accountAddresses[accountId][chainId];
        if (!accountAddress.registered) revert NoAddressRegistered(accountId, chainId);
        return accountAddress.addr;
    }

    /**
     * @notice Get address invited to account on given chain
     * @param accountId The account id
     * @param chainId The chain id
     */
    function getAddressInvitedToAccountOnChain(
        bytes32 accountId,
        uint16 chainId
    ) external view override returns (bytes32) {
        if (!isAccountCreated(accountId)) revert UnknownAccount(accountId);
        AccountAddress memory accountAddress = accountAddresses[accountId][chainId];
        if (!accountAddress.invited) revert NoAddressInvited(accountId, chainId);
        return accountAddress.addr;
    }

    /**
     * @notice Check if account is created
     * @param accountId The account id
     */
    function isAccountCreated(bytes32 accountId) public view override returns (bool) {
        return accounts[accountId] > 0;
    }

    /**
     * @notice Check if address is registered
     * @param chainId The chain id
     * @param addr The generic address
     */
    function isAddressRegistered(uint16 chainId, bytes32 addr) public view override returns (bool) {
        return registeredAddresses[addr][chainId] != bytes32(0);
    }

    /**
     * @notice Check if address is invited
     * @param accountId The account id
     * @param chainId The chain id
     * @param addr The generic address
     */
    function isAddressInvitedToAccount(
        bytes32 accountId,
        uint16 chainId,
        bytes32 addr
    ) public view override returns (bool) {
        AccountAddress memory accountAddress = accountAddresses[accountId][chainId];
        return accountAddress.addr == addr && accountAddress.invited;
    }

    /**
     * @notice Check if address is registered
     * @param accountId The account id
     * @param chainId The chain id
     * @param addr The generic address
     */
    function isAddressRegisteredToAccount(
        bytes32 accountId,
        uint16 chainId,
        bytes32 addr
    ) public view override returns (bool) {
        AccountAddress memory accountAddress = accountAddresses[accountId][chainId];
        return accountAddress.addr == addr && accountAddress.registered;
    }

    /**
     * @notice Check if address is a delegate
     * @param accountId The account id
     * @param addr The generic address
     */
    function isDelegate(bytes32 accountId, address addr) public view override returns (bool) {
        return accountDelegatedAddresses[accountId][addr];
    }
}
