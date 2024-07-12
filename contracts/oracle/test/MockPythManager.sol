// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";

contract MockPythManager is MockPyth {
    constructor(
        uint256 _validTimePeriod,
        uint256 _singleUpdateFeeInWei
    ) MockPyth(_validTimePeriod, _singleUpdateFeeInWei) {}
}
