// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

import "../storage/NodeDefinition.sol";
import "../storage/NodeOutput.sol";
import "../interfaces/IExternalNode.sol";

library ExternalNode {
    /// @dev Processes the prices using an external node.
    /// @param prices The prices to process if etrernal node is a composite node.
    /// @param parameters The parameters for the external node.
    /// @return nodeOutput The output of the external node.
    function process(
        NodeOutput.Data[] memory prices,
        bytes memory parameters
    ) internal view returns (NodeOutput.Data memory nodeOutput) {
        IExternalNode externalNode = IExternalNode(abi.decode(parameters, (address)));
        return externalNode.process(prices, parameters);
    }

    /// @dev Checks if a node definition is valid for an external node.
    /// @param nodeDefinition The node definition to check.
    /// @return Boolean indicating whether the node definition is valid.
    function isValid(NodeDefinition.Data memory nodeDefinition) internal returns (bool) {
        /// @dev only one parameter to be converted to address i.e. the external contract
        if (nodeDefinition.parameters.length != 32) {
            return false;
        }
        address externalNode = abi.decode(nodeDefinition.parameters, (address));
        /// @dev check if external node supports interface and call isValid
        return
            ERC165Checker.supportsERC165InterfaceUnchecked(externalNode, type(IExternalNode).interfaceId) &&
            IExternalNode(externalNode).isValid(nodeDefinition);
    }
}
