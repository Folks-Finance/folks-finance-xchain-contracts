// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract MockChainlinkAggregator is AggregatorV3Interface {
    uint8 private _decimals;
    int256[] private _prices;
    uint256[] private _updatedAt;
    uint80 _roundId;

    constructor(uint8 decimals_, int256[] memory prices, uint256[] memory timestampDeltas) {
        uint256 currentTimestamp = block.timestamp;
        _decimals = decimals_;
        _prices = prices;
        _roundId = uint80(timestampDeltas.length);
        _updatedAt.push(currentTimestamp - timestampDeltas[0]);
        for (uint256 i = 1; i < timestampDeltas.length; i++) {
            assert(timestampDeltas[i - 1] > timestampDeltas[i]);
            _updatedAt.push(currentTimestamp - timestampDeltas[i]);
        }
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function description() external pure override returns (string memory) {
        return "MockChainlinkAggregator";
    }

    function version() external pure override returns (uint256) {
        return 1;
    }

    function getRoundData(
        uint80 roundId_
    )
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (roundId_, _prices[roundId_ - 1], 0, _updatedAt[roundId_ - 1], roundId);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _prices[_roundId - 1], 0, _updatedAt[_roundId - 1], roundId);
    }
}
