// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "../storage/NodeDefinition.sol";
import "../storage/NodeOutput.sol";

library ChainlinkNode {
    using SafeCast for int256;
    using Math for uint256;

    /// @dev The precision to standardize price
    uint256 public constant PRECISION = 18;

    /// @notice Get the Chainlink price feed, compute the TWAP if twapTimeInterval is not zero and returns the node output.
    /// @param parameters Params in bytes to decode in order to extract: Chainlink aggregator address, TWAP time interval and decimals.
    /// @return nodeOutput The output given by: price processed (standardized to 18 d.p.), timestamp i.e. updatedAt from Chainlink response, node type.
    function process(bytes memory parameters) internal view returns (NodeOutput.Data memory nodeOutput) {
        (address chainlinkAggregatorAddr, uint256 twapTimeInterval, uint8 decimals) = abi.decode(
            parameters,
            (address, uint256, uint8)
        );

        AggregatorV3Interface chainlinkAggregator = AggregatorV3Interface(chainlinkAggregatorAddr);
        (uint80 roundId, int256 answer, , uint256 updatedAt, ) = chainlinkAggregator.latestRoundData();

        /// @dev Calculate the price. If the TWAP time interval is 0, use the latest price. Otherwise, calculate the TWAP price.
        uint256 price = twapTimeInterval == 0
            ? answer.toUint256()
            : getTwapPrice(chainlinkAggregator, roundId, answer.toUint256(), twapTimeInterval);

        /// @dev Adjust the price to 18 d.p.
        price = decimals > PRECISION ? price / (10 ** (decimals - PRECISION)) : price * (10 ** (PRECISION - decimals));

        return NodeOutput.Data(price, updatedAt, NodeDefinition.NodeType.CHAINLINK, 0, 0);
    }

    /// @notice Calculates the Time-Weighted Average Price (TWAP) for a Chainlink feed from all the prices between the latest round and the latest round before the time interval.
    /// @param chainlink The Chainlink aggregator contract.
    /// @param latestRoundId The latest round ID.
    /// @param latestPrice The latest price.
    /// @param twapTimeInterval The TWAP time interval.
    /// @return price The TWAP price.
    function getTwapPrice(
        AggregatorV3Interface chainlink,
        uint80 latestRoundId,
        uint256 latestPrice,
        uint256 twapTimeInterval
    ) internal view returns (uint256 price) {
        uint256 priceSum = latestPrice;
        uint256 priceCount = 1;

        uint256 startTime = block.timestamp - twapTimeInterval;

        /// @dev Iterate over the previous rounds until reaching a round that was updated before the start time
        while (latestRoundId > 0) {
            try chainlink.getRoundData(--latestRoundId) returns (
                uint80,
                int256 answer,
                uint256,
                uint256 updatedAt,
                uint80
            ) {
                if (updatedAt < startTime) {
                    break;
                }
                priceSum += answer.toUint256();
                priceCount++;
            } catch {
                break;
            }
        }

        return priceSum / priceCount;
    }

    /// @notice Checks if the node definition is valid.
    /// @param nodeDefinition The node definition to check.
    /// @return A boolean indicating whether the node definition is valid.
    function isValid(NodeDefinition.Data memory nodeDefinition) internal view returns (bool) {
        /// @dev Must have no parents and three parameters: contract address, twapInterval, decimals
        if (nodeDefinition.parents.length > 0 || nodeDefinition.parameters.length != 32 * 3) {
            return false;
        }

        (address chainlinkAggregatorAddr, , uint8 decimals) = abi.decode(
            nodeDefinition.parameters,
            (address, uint256, uint8)
        );
        AggregatorV3Interface chainlinkAggregator = AggregatorV3Interface(chainlinkAggregatorAddr);

        /// @dev Check call Chainlink without error
        chainlinkAggregator.latestRoundData();

        return decimals == chainlinkAggregator.decimals();
    }
}
