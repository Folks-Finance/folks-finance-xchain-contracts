import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { PRECISION, abi, getOracleNodeId } from "../utils/utils";
import NodeType from "../assets/NodeType";
import { deployNodeManagerFixture } from "../bootstrap";
import { NodeDefinitionData, NodeManagerUtil } from "../utils/nodeManagerUtils";
import { NodeManager } from "../../../typechain-types/contracts/oracle/modules/NodeManager";
import { MockConstantPriceAndTimestampNode } from "../../../typechain-types";

describe("PriceDeviationSameOracleCircuitBreakerNode", async function () {
  let nodeManager: NodeManager;
  let constantPriceAndTimestampNodePrice: number;
  let constantPriceAndTimestampNodeTimestamp: number;
  let mockConstantPriceAndTimestampNode: MockConstantPriceAndTimestampNode;
  let externalNodePrice: number;
  let constant42NodePrice: number;
  let constant69NodePrice: number;
  let external22NodeId: string;
  let constant42NodeId: string;
  let constant69NodeId: string;

  beforeEach("Deploy NodeManager contract and register nodes", async function () {
    ({ nodeManager } = await loadFixture(deployNodeManagerFixture));

    const MockConstantPriceAndTimestampNode = await ethers.getContractFactory("MockConstantPriceAndTimestampNode");
    constantPriceAndTimestampNodePrice = 22e14;
    externalNodePrice = constantPriceAndTimestampNodePrice;
    constantPriceAndTimestampNodeTimestamp = 69420;
    constant42NodePrice = 42e14;
    constant69NodePrice = 69e14;
    mockConstantPriceAndTimestampNode = await MockConstantPriceAndTimestampNode.deploy(
      constantPriceAndTimestampNodePrice,
      constantPriceAndTimestampNodeTimestamp
    );
    await mockConstantPriceAndTimestampNode.waitForDeployment();

    external22NodeId = await NodeManagerUtil.registerNode(
      nodeManager,
      NodeManagerUtil.encodeExternalNodeDefinition(await mockConstantPriceAndTimestampNode.getAddress())
    );
    constant42NodeId = await NodeManagerUtil.registerNode(
      nodeManager,
      NodeManagerUtil.encodeConstantNodeDefinition(constant42NodePrice)
    );
    constant69NodeId = await NodeManagerUtil.registerNode(
      nodeManager,
      NodeManagerUtil.encodeConstantNodeDefinition(constant69NodePrice)
    );
  });

  describe("Register node", async function () {
    it("Should register a PriceDeviationSameOracleCircuitBreaker node", async function () {
      const deviationTolerance = 1e18;
      const encodedParams = abi.encode(["uint256"], [deviationTolerance.toString()]);
      const parentNodeIds = [external22NodeId, constant42NodeId, constant69NodeId];
      const nodeDefinition: NodeDefinitionData = [
        NodeType.PRICE_DEVIATION_SAME_ORACLE_CIRCUIT_BREAKER,
        encodedParams,
        parentNodeIds,
      ];
      const registerTxn = await nodeManager.registerNode(...nodeDefinition);
      await registerTxn.wait();

      const nodeId = getOracleNodeId(...nodeDefinition);
      const node = await nodeManager.getNode(nodeId);

      expect(node.nodeType).to.equal(NodeType.PRICE_DEVIATION_SAME_ORACLE_CIRCUIT_BREAKER);
      expect(node.parameters).to.equal(encodedParams);
      expect(node.parents).to.deep.equal(parentNodeIds);
    });

    it("Should emit InvalidNodeDefinition cause parameters length is not 32", async function () {
      const encodedParams = "0x00";
      const parentNodeIds = [external22NodeId, constant42NodeId, constant69NodeId];
      const nodeDefinition: NodeDefinitionData = [
        NodeType.PRICE_DEVIATION_SAME_ORACLE_CIRCUIT_BREAKER,
        encodedParams,
        parentNodeIds,
      ];

      const registerTxn = nodeManager.registerNode(...nodeDefinition);

      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });

    it("Should emit InvalidNodeDefinition cause has no parent node", async function () {
      const deviationTolerance = 1e18;
      const encodedParams = abi.encode(["uint256"], [deviationTolerance.toString()]);
      const nodeDefinition: NodeDefinitionData = [
        NodeType.PRICE_DEVIATION_SAME_ORACLE_CIRCUIT_BREAKER,
        encodedParams,
        [],
      ];

      const registerTxn = nodeManager.registerNode(...nodeDefinition);

      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });

    describe("Contract methods", async function () {
      let deviationTolerance: number;
      let parentNodeIds: string[];
      let nodeId: string;

      it("Should process correctly when price < comparison price", async function () {
        deviationTolerance = 1e18;
        parentNodeIds = [external22NodeId, constant42NodeId, constant69NodeId];
        const encodedParams = NodeManagerUtil.encodePriceDeviationSameOracleCircuitBreakerNodeDefinition(
          deviationTolerance,
          parentNodeIds
        );
        nodeId = await NodeManagerUtil.registerNode(nodeManager, encodedParams);

        const nodeOutput = await nodeManager.process(nodeId);

        expect(nodeOutput.price).to.equal(externalNodePrice);
      });

      it("Should process correctly when price > comparison price", async function () {
        deviationTolerance = 1e18;
        parentNodeIds = [constant42NodeId, external22NodeId, constant69NodeId];
        const encodedParams = NodeManagerUtil.encodePriceDeviationSameOracleCircuitBreakerNodeDefinition(
          deviationTolerance,
          parentNodeIds
        );
        nodeId = await NodeManagerUtil.registerNode(nodeManager, encodedParams);

        const nodeOutput = await nodeManager.process(nodeId);

        expect(nodeOutput.price).to.equal(constant42NodePrice);
      });

      it("Should process the third node price cause price th not met", async function () {
        parentNodeIds = [external22NodeId, constant42NodeId, constant69NodeId];
        deviationTolerance =
          (Math.abs(externalNodePrice - constant42NodePrice) * 10 ** PRECISION) / externalNodePrice + 1;
        const encodedParams = NodeManagerUtil.encodePriceDeviationSameOracleCircuitBreakerNodeDefinition(
          deviationTolerance,
          parentNodeIds
        );
        nodeId = await NodeManagerUtil.registerNode(nodeManager, encodedParams);

        const nodeOutput = await nodeManager.process(nodeId);

        expect(nodeOutput.price).to.equal(constant69NodePrice);
      });

      it("Should raise DeviationToleranceExceeded", async function () {
        deviationTolerance = (Math.abs(externalNodePrice - constant42NodePrice) * 10 ** PRECISION) / externalNodePrice;
        parentNodeIds = [external22NodeId, constant42NodeId];
        const encodedParams = NodeManagerUtil.encodePriceDeviationSameOracleCircuitBreakerNodeDefinition(
          deviationTolerance,
          parentNodeIds
        );
        nodeId = await NodeManagerUtil.registerNode(nodeManager, encodedParams);

        const nodeOutput = nodeManager.process(nodeId);

        await expect(nodeOutput).to.revertedWithCustomError(nodeManager, "DeviationToleranceExceeded");
      });

      it("Should raise SameOracle", async function () {
        deviationTolerance =
          (Math.abs(constant69NodePrice - constant42NodePrice) * 10 ** PRECISION) / constant69NodePrice + 1;
        parentNodeIds = [constant42NodeId, constant69NodeId];
        const encodedParams = NodeManagerUtil.encodePriceDeviationSameOracleCircuitBreakerNodeDefinition(
          deviationTolerance,
          parentNodeIds
        );
        nodeId = await NodeManagerUtil.registerNode(nodeManager, encodedParams);

        const nodeOutput = nodeManager.process(nodeId);

        await expect(nodeOutput).to.revertedWithCustomError(nodeManager, "SameOracle");
      });
    });
  });
});
