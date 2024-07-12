// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../storage/NodeDefinition.sol";
import "../storage/NodeOutput.sol";

library StalenessCircuitBreakerNode {
    /// @dev Error to be thrown when the staleness tolerance is exceeded.
    error StalenessToleranceExceeded();

    /// @notice Checks if the last update time of the parent node is less than the threshold and returns its price
    ///         otherwise if a second parent node is provided it returns its price without checking the staleness
    ///         otherwise revert.
    /// @param parentsNodeOutput The outputs of the parent nodes, the first parent is the node to check the staleness the second is the fallback.
    /// @param parameters Params in bytes to decode in order to extract: stalenessTolerance in seconds.
    /// @return nodeOutput The output The computed node output.
    function process(
        NodeOutput.Data[] memory parentsNodeOutput,
        bytes memory parameters
    ) internal view returns (NodeOutput.Data memory nodeOutput) {
        uint256 stalenessTolerance = abi.decode(parameters, (uint256));

        if (block.timestamp - parentsNodeOutput[0].timestamp <= stalenessTolerance) {
            return parentsNodeOutput[0];
        }

        if (parentsNodeOutput.length == 2) {
            return parentsNodeOutput[1];
        }

        revert StalenessToleranceExceeded();
    }

    /// @notice Checks if a node definition is valid.
    /// @param nodeDefinition The node definition to check.
    /// @return A boolean indicating whether the node definition is valid.
    function isValid(NodeDefinition.Data memory nodeDefinition) internal pure returns (bool) {
        // @dev Must have 1 or 2 parents and only one parameter to be converted to uint256 i.e. the stalenessTolerance
        return
            nodeDefinition.parents.length > 0 &&
            nodeDefinition.parents.length < 3 &&
            nodeDefinition.parameters.length == 32;
    }
}
