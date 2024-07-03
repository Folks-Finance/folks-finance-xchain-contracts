// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.19;

interface IAddressOracle {
    error AddressIneligible(address addr, uint16 action);

    function isEligible(address addr, uint16 action) external view returns (bool);
}
