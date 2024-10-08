// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

interface IAccountManager {
    struct AccountAddress {
        bytes32 addr;
        bool invited;
        bool registered;
    }

    error GeneratedAccountIdMismatch(bytes32 expected, bytes32 actual);
    error AccountAlreadyCreated(bytes32 accountId);
    error CannotDeleteAccount(bytes32 accountId);
    error AddressPreviouslyRegistered(uint16 chainId, bytes32 addr);
    error AccountHasAddressRegistered(bytes32 accountId, uint16 chainId);
    error UnknownAccount(bytes32 accountId);
    error InvalidReferrerAccount(bytes32 accountId);
    error NotRegisteredToAccount(bytes32 accountId, uint16 chainId, bytes32 addr);
    error NotInvitedToAccount(bytes32 accountId, uint16 chainId, bytes32 addr);
    error NoAddressToUnregister(bytes32 accountId, uint16 chainId);
    error NoAddressRegistered(bytes32 accountId, uint16 chainId);
    error NoAddressInvited(bytes32 accountId, uint16 chainId);
    error DelegateAlreadyAdded(bytes32 accountId, address addr);
    error NoDelegateToRemove(bytes32 accountId, address addr);
    error NoPermissionOnHub(bytes32 accountId, address addr);
    error NoAccountRegisteredTo(uint16 chainId, bytes32 addr);

    event CreateAccount(bytes32 accountId, uint16 chainId, bytes32 addr, bytes32 indexed refAccountId);
    event InviteAddress(
        bytes32 accountId,
        uint16 indexed inviteeChainId,
        bytes32 indexed inviteeAddr,
        bytes32 indexed refAccountId
    );
    event AcceptInviteAddress(bytes32 accountId, uint16 chainId, bytes32 addr);
    event UnregisterAddress(bytes32 accountId, uint16 unregisterChainId, bytes32 unregisterAddr);
    event AddDelegate(bytes32 accountId, address indexed addr);
    event RemoveDelegate(bytes32 accountId, address indexed addr);

    function HUB_ROLE() external view returns (bytes32);

    function getNumAddressesRegisteredToAccount(bytes32 accountId) external view returns (uint16);
    function getAccountIdOfAddressOnChain(bytes32 addr, uint16 chainId) external view returns (bytes32);
    function getAddressRegisteredToAccountOnChain(bytes32 accountId, uint16 chainId) external view returns (bytes32);
    function getAddressInvitedToAccountOnChain(bytes32 accountId, uint16 chainId) external view returns (bytes32);

    function createAccount(
        bytes32 accountId,
        uint16 chainId,
        bytes32 addr,
        bytes4 nonce,
        bytes32 refAccountId
    ) external;
    function inviteAddress(
        bytes32 accountId,
        uint16 inviteeChainId,
        bytes32 inviteeAddr,
        bytes32 refAccountId
    ) external;
    function acceptInviteAddress(bytes32 accountId, uint16 chainId, bytes32 addr) external;
    function unregisterAddress(bytes32 accountId, uint16 unregisterChainId) external;
    function addDelegate(bytes32 accountId, address addr) external;
    function removeDelegate(bytes32 accountId, address addr) external;

    function isAccountCreated(bytes32 accountId) external view returns (bool);
    function isAddressRegistered(uint16 chainId, bytes32 addr) external view returns (bool);
    function isAddressInvitedToAccount(bytes32 accountId, uint16 chainId, bytes32 addr) external view returns (bool);
    function isAddressRegisteredToAccount(bytes32 accountId, uint16 chainId, bytes32 addr) external view returns (bool);
    function isDelegate(bytes32 accountId, address addr) external view returns (bool);
}
