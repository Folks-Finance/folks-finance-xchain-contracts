// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.23;

import "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import "./interfaces/IAddressOracle.sol";

contract SpokeState is AccessControlDefaultAdminRules {
    struct Hub {
        uint16 chainId;
        bytes32 contractAddress;
    }

    bytes32 public constant CONFIG_CONTRACTS_ROLE = keccak256("CONFIG_CONTRACTS");

    Hub internal _hub;
    IAddressOracle internal _addressOracle;

    constructor(
        address admin,
        uint16 hubChainId,
        bytes32 hubContractAddress,
        IAddressOracle addressOracle_
    ) AccessControlDefaultAdminRules(1 days, admin) {
        _setHub(hubChainId, hubContractAddress);
        _setAddressOracle(addressOracle_);
        _grantRole(CONFIG_CONTRACTS_ROLE, admin);
    }

    function setHub(uint16 chainId, bytes32 contractAddress) external onlyRole(CONFIG_CONTRACTS_ROLE) {
        _setHub(chainId, contractAddress);
    }

    function setAddressOracle(IAddressOracle newAddressOracle) external onlyRole(CONFIG_CONTRACTS_ROLE) {
        _setAddressOracle(newAddressOracle);
    }

    function _setHub(uint16 chainId, bytes32 contractAddress) internal {
        _hub = SpokeState.Hub({ chainId: chainId, contractAddress: contractAddress });
    }

    function _setAddressOracle(IAddressOracle newAddressOracle) internal {
        _addressOracle = newAddressOracle;
    }

    function getHubChainId() public view returns (uint16) {
        return _hub.chainId;
    }

    function getHubContractAddress() public view returns (bytes32) {
        return _hub.contractAddress;
    }

    function getAddressOracle() public view returns (address) {
        return address(_addressOracle);
    }
}
