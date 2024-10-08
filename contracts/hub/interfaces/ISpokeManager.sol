// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

interface ISpokeManager {
    error SpokeAlreadyActive(uint16 chainId, bytes32 addr);
    error SpokeNotActive(uint16 chainId, bytes32 addr);

    function MANAGER_ROLE() external view returns (bytes32);

    function activateSpoke(uint16 chainId, bytes32 addr) external;
    function depreciateSpoke(uint16 chainId, bytes32 addr) external;
    function isSpoke(uint16 chainId, bytes32 addr) external view returns (bool);
}
