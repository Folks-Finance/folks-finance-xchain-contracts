// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";

import "../storage/NodeDefinition.sol";
import "../storage/NodeOutput.sol";

library PriceDeviationCircuitBreakerNode {
    using Math for uint256;

    uint256 internal constant WAD = 1e18;

    /// @dev Error to be thrown when the deviation tolerance is exceeded.
    error DeviationToleranceExceeded(uint256 deviation);
    /// @dev Error to be thrown when the price of first node is zero.
    error ZeroPrice(NodeDefinition.NodeType nodeType);

    /// @notice Checks if the price deviation is within the tolerance and returns the first parent node output or if provided the fallback node output else reverts.
    /// @param parentNodeOutputs The outputs of the parent nodes, the first two are the price and the comparison price, the third is the fallback node output.
    /// @param parameters Params in bytes to decode in order to extract: deviation tolerance, it has 18 dp.
    /// @return nodeOutput The computed node output.
    function process(
        NodeOutput.Data[] memory parentNodeOutputs,
        bytes memory parameters
    ) internal pure returns (NodeOutput.Data memory) {
        uint256 deviationTolerance = abi.decode(parameters, (uint256));

        uint256 price = parentNodeOutputs[0].price;
        uint256 comparisonPrice = parentNodeOutputs[1].price;

        uint256 difference = price > comparisonPrice ? price - comparisonPrice : comparisonPrice - price;
        bool priceIsZero = price == 0;

        if (priceIsZero || difference.mulDiv(WAD, price) > deviationTolerance) {
            if (parentNodeOutputs.length > 2) return parentNodeOutputs[2];
            if (priceIsZero) revert ZeroPrice(parentNodeOutputs[0].nodeType);
            revert DeviationToleranceExceeded(difference.mulDiv(WAD, price));
        }

        return parentNodeOutputs[0];
    }

    /// @notice Checks if a node definition is valid.
    /// @param nodeDefinition The node definition to check.
    /// @return A boolean indicating whether the node definition is valid.
    function isValid(NodeDefinition.Data memory nodeDefinition) internal pure returns (bool) {
        /// @dev Must have 2 or 3 parents and only one parameter to be converted to uint256 i.e. the deviationTolerance
        return
            (nodeDefinition.parents.length > 1 && nodeDefinition.parents.length < 4) &&
            nodeDefinition.parameters.length == 32;
    }
}
