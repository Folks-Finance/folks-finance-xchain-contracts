// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "../interfaces/IExternalNode.sol";
import "../storage/NodeDefinition.sol";
import "../storage/NodeOutput.sol";

contract MockNoValid is IExternalNode {
    NodeOutput.Data private output;

    constructor(uint256 price, uint256 timestamp) {
        output.price = price;
        output.timestamp = timestamp;
    }

    function process(NodeOutput.Data[] memory, bytes memory) external view returns (NodeOutput.Data memory) {
        return output;
    }

    function isValid(NodeDefinition.Data memory) external pure returns (bool) {
        return false;
    }

    function supportsInterface(bytes4) public view virtual override(IERC165) returns (bool) {
        return true;
    }
}
