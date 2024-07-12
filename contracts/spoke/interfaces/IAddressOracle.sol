// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

interface IAddressOracle {
    error AddressIneligible(address addr, uint16 action);

    function isEligible(address addr, uint16 action) external view returns (bool);
}
