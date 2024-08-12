// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

import "../storage/NodeDefinition.sol";
import "../storage/NodeOutput.sol";

library PythNode {
    using Math for uint256;
    using SafeCast for int64;
    using SafeCast for int256;

    /// @dev The precision of the standardized price
    int256 public constant PRECISION = 18;

    /// @notice Get the Pyth price or EMA price and returns the node output.
    /// @param parameters Params in bytes to decode in order to extract: Pyth contract address, price feed id and use EMA.
    /// @return nodeOutput The output given by: price processed (standardized to 18 d.p.), timestamp i.e. publishTime from Pyth response, node type.
    function process(bytes memory parameters) internal view returns (NodeOutput.Data memory nodeOutput) {
        (address pythAddress, bytes32 priceFeedId, bool useEma) = abi.decode(parameters, (address, bytes32, bool));

        /// @dev using unsafe methods to avoid reverting, so this accepts old data
        IPyth pyth = IPyth(pythAddress);
        PythStructs.Price memory pythData = useEma
            ? pyth.getEmaPriceUnsafe(priceFeedId)
            : pyth.getPriceUnsafe(priceFeedId);

        /// @dev adjust the price to 18 d.p., exponent is a int32 so it could be negative or positive
        int256 factor = PRECISION + pythData.expo;
        uint256 price = factor > 0
            ? pythData.price.toUint256() * (10 ** factor.toUint256())
            : pythData.price.toUint256() / (10 ** (-factor).toUint256());

        return NodeOutput.Data(price, pythData.publishTime, NodeDefinition.NodeType.PYTH, 0, 0);
    }

    /// @notice Checks if a node definition is valid.
    /// @param nodeDefinition The node definition to check.
    /// @return valid A boolean indicating whether the node definition is valid.
    function isValid(NodeDefinition.Data memory nodeDefinition) internal view returns (bool valid) {
        /// @dev Must have no parents and three parameters: contract pythAddress, priceFeedId, useEma
        if (nodeDefinition.parents.length > 0 || nodeDefinition.parameters.length != 32 * 3) {
            return false;
        }

        (address pythAddress, bytes32 priceFeedId, bool useEma) = abi.decode(
            nodeDefinition.parameters,
            (address, bytes32, bool)
        );
        IPyth pyth = IPyth(pythAddress);

        /// @dev Check call pyth without error
        useEma ? pyth.getEmaPriceUnsafe(priceFeedId) : pyth.getPriceUnsafe(priceFeedId);

        return true;
    }
}
