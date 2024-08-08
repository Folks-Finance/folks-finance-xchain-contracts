import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { MockConstantPriceAndTimestampNode, NodeManager } from "../../../typechain-types";
import NodeType from "../assets/NodeType";
import { deployNodeManagerFixture } from "../bootstrap";
import { NodeDefinitionData, NodeManagerUtil } from "../utils/nodeManagerUtils";
import { abi, getOracleNodeId } from "../utils/utils";

describe("StalenessCircuitBreakerNode", async function () {
  let nodeManager: NodeManager;

  // In the names convention, the number after the "P" is the price and the number after the "TS" is the timestamp

  let constant22PriceAnd1hAgoTsNodePrice: number;
  let constant22PriceAnd1hAgoTsNodeTs: number;
  let mockConstant22PriceAnd1hAgoTsNode: MockConstantPriceAndTimestampNode;
  let externalP22TS1HNodePrice: number;
  let externalP22TS1HNodeTs: number;
  let externalP22TS1HNodeId: string;

  let constant22PriceAnd1hAfterTsNodePrice: number;
  let constant22PriceAnd1hAfterTsNodeTs: number;
  let mockConstant22PriceAnd1hAfterTsNode: MockConstantPriceAndTimestampNode;
  let externalP22TS1HAfterNodePrice: number;
  let externalP22TS1HAfterNodeId: string;

  let constant42PriceAnd2hAgoTsNodePrice: number;
  let constant42PriceAnd2hAgoTsNodeTs: number;
  let mockConstant42PriceAnd2hAgoTsNode: MockConstantPriceAndTimestampNode;
  let externalP42TS2HNodePrice: number;
  let externalP42TS2HNodeTs: number;
  let externalP42TS2HNodeId: string;

  let latestBlockTimestamp: number;
  beforeEach("Deploy NodeManager contract and register nodes", async function () {
    ({ nodeManager } = await loadFixture(deployNodeManagerFixture));

    const MockConstantPriceAndTimestampNode = await ethers.getContractFactory("MockConstantPriceAndTimestampNode");
    latestBlockTimestamp = (await ethers.provider.getBlock("latest"))?.timestamp as number;

    constant22PriceAnd1hAgoTsNodePrice = externalP22TS1HNodePrice = 22e14;
    constant22PriceAnd1hAgoTsNodeTs = externalP22TS1HNodeTs = latestBlockTimestamp - 60 * 60;

    mockConstant22PriceAnd1hAgoTsNode = await MockConstantPriceAndTimestampNode.deploy(
      constant22PriceAnd1hAgoTsNodePrice,
      constant22PriceAnd1hAgoTsNodeTs
    );
    await mockConstant22PriceAnd1hAgoTsNode.waitForDeployment();

    constant22PriceAnd1hAfterTsNodePrice = externalP22TS1HAfterNodePrice = 22e14;
    constant22PriceAnd1hAfterTsNodeTs = externalP22TS1HNodeTs = latestBlockTimestamp + 60 * 60;
    mockConstant22PriceAnd1hAfterTsNode = await MockConstantPriceAndTimestampNode.deploy(
      constant22PriceAnd1hAfterTsNodePrice,
      constant22PriceAnd1hAfterTsNodeTs
    );
    await mockConstant22PriceAnd1hAfterTsNode.waitForDeployment();

    constant42PriceAnd2hAgoTsNodePrice = externalP42TS2HNodePrice = 42e14;
    constant42PriceAnd2hAgoTsNodeTs = externalP42TS2HNodeTs = latestBlockTimestamp - 2 * 60 * 60;

    mockConstant42PriceAnd2hAgoTsNode = await MockConstantPriceAndTimestampNode.deploy(
      constant42PriceAnd2hAgoTsNodePrice,
      constant42PriceAnd2hAgoTsNodeTs
    );
    await mockConstant42PriceAnd2hAgoTsNode.waitForDeployment();

    externalP22TS1HNodeId = await NodeManagerUtil.registerNode(
      nodeManager,
      await NodeManagerUtil.encodeExternalNodeDefinition(await mockConstant22PriceAnd1hAgoTsNode.getAddress())
    );
    externalP22TS1HAfterNodeId = await NodeManagerUtil.registerNode(
      nodeManager,
      await NodeManagerUtil.encodeExternalNodeDefinition(await mockConstant22PriceAnd1hAfterTsNode.getAddress())
    );
    externalP42TS2HNodeId = await NodeManagerUtil.registerNode(
      nodeManager,
      await NodeManagerUtil.encodeExternalNodeDefinition(await mockConstant42PriceAnd2hAgoTsNode.getAddress())
    );
  });

  describe("Register node", async function () {
    it("Should register a StalenessCircuitBreakerNode node", async function () {
      const stalenessTolerance = 3 * 60 * 60;
      const encodedParams = abi.encode(["uint256"], [stalenessTolerance.toString()]);
      const parentNodeIds = [externalP22TS1HNodeId, externalP42TS2HNodeId];
      const nodeDefinition: NodeDefinitionData = [NodeType.STALENESS_CIRCUIT_BREAKER, encodedParams, parentNodeIds];
      const nodeId = getOracleNodeId(...nodeDefinition);

      const registerTxn = await nodeManager.registerNode(...nodeDefinition);
      await registerTxn.wait();

      const node = await nodeManager.getNode(nodeId);
      expect(node.nodeType).to.equal(NodeType.STALENESS_CIRCUIT_BREAKER);
      expect(node.parameters).to.equal(encodedParams);
      expect(node.parents).to.deep.equal(parentNodeIds);
    });
    it("Should emit InvalidNodeDefinition cause parameters length is not 32", async function () {
      const encodedParams = "0x00";
      const parentNodeIds = [externalP22TS1HNodeId, externalP42TS2HNodeId];
      const nodeDefinition: NodeDefinitionData = [NodeType.STALENESS_CIRCUIT_BREAKER, encodedParams, parentNodeIds];

      const registerTxn = nodeManager.registerNode(...nodeDefinition);

      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });

    it("Should emit InvalidNodeDefinition cause has no parent node", async function () {
      const stalenessTolerance = latestBlockTimestamp;
      const encodedParams = abi.encode(["uint256"], [stalenessTolerance.toString()]);
      const nodeDefinition: NodeDefinitionData = [NodeType.STALENESS_CIRCUIT_BREAKER, encodedParams, []];

      const registerTxn = nodeManager.registerNode(...nodeDefinition);

      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });

    it("Should emit InvalidNodeDefinition cause staleness tolerance > block timestamp", async function () {
      const stalenessTolerance = latestBlockTimestamp * 2;
      const encodedParams = abi.encode(["uint256"], [stalenessTolerance.toString()]);
      const nodeDefinition: NodeDefinitionData = [NodeType.STALENESS_CIRCUIT_BREAKER, encodedParams, []];

      const registerTxn = nodeManager.registerNode(...nodeDefinition);

      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });

    it("Should emit InvalidNodeDefinition cause has no more than 2 parents node", async function () {
      const fakeParent = ethers.encodeBytes32String("FakeParent");
      const stalenessTolerance = latestBlockTimestamp;
      const encodedParams = abi.encode(["uint256"], [stalenessTolerance.toString()]);
      const nodeDefinition: NodeDefinitionData = [
        NodeType.STALENESS_CIRCUIT_BREAKER,
        encodedParams,
        [externalP22TS1HNodeId, externalP42TS2HNodeId, fakeParent],
      ];

      const registerTxn = nodeManager.registerNode(...nodeDefinition);

      await expect(registerTxn).to.revertedWithCustomError(nodeManager, "InvalidNodeDefinition");
    });

    describe("Contract methods", async function () {
      let stalenessTolerance: number;
      let parentNodeIds: string[];
      let nodeId: string;

      beforeEach("Register StalenessCircuitBreakerNode", async function () {});

      it("Should process correctly", async function () {
        stalenessTolerance = latestBlockTimestamp;
        const encodedParams = abi.encode(["uint256"], [stalenessTolerance.toString()]);
        parentNodeIds = [externalP22TS1HNodeId, externalP42TS2HNodeId];
        const nodeDefinition: NodeDefinitionData = [NodeType.STALENESS_CIRCUIT_BREAKER, encodedParams, parentNodeIds];
        nodeId = getOracleNodeId(...nodeDefinition);

        const registerTxn = await nodeManager.registerNode(...nodeDefinition);
        await registerTxn.wait();

        const nodeOutput = await nodeManager.process(nodeId);
        expect(nodeOutput.price).to.equal(externalP22TS1HNodePrice);
      });

      it("Should process correctly when node ts > block timestamp", async function () {
        stalenessTolerance = latestBlockTimestamp;
        const encodedParams = abi.encode(["uint256"], [stalenessTolerance.toString()]);
        parentNodeIds = [externalP22TS1HAfterNodeId, externalP42TS2HNodeId];
        const nodeDefinition: NodeDefinitionData = [NodeType.STALENESS_CIRCUIT_BREAKER, encodedParams, parentNodeIds];
        nodeId = getOracleNodeId(...nodeDefinition);

        const registerTxn = await nodeManager.registerNode(...nodeDefinition);
        await registerTxn.wait();

        const nodeOutput = await nodeManager.process(nodeId);
        expect(nodeOutput.price).to.equal(externalP22TS1HAfterNodePrice);
      });

      it("Should process correctly but with 2nd parent price", async function () {
        stalenessTolerance = 0;
        const encodedParams = abi.encode(["uint256"], [stalenessTolerance.toString()]);
        parentNodeIds = [externalP22TS1HNodeId, externalP42TS2HNodeId];
        const nodeDefinition: NodeDefinitionData = [NodeType.STALENESS_CIRCUIT_BREAKER, encodedParams, parentNodeIds];
        nodeId = getOracleNodeId(...nodeDefinition);

        const registerTxn = await nodeManager.registerNode(...nodeDefinition);
        await registerTxn.wait();

        const nodeOutput = await nodeManager.process(nodeId);
        expect(nodeOutput.price).to.equal(externalP42TS2HNodePrice);
      });

      it("Should raise StalenessToleranceExceeded", async function () {
        stalenessTolerance = 0;
        const encodedParams = abi.encode(["uint256"], [stalenessTolerance.toString()]);
        parentNodeIds = [externalP22TS1HNodeId];
        const nodeDefinition: NodeDefinitionData = [NodeType.STALENESS_CIRCUIT_BREAKER, encodedParams, parentNodeIds];
        nodeId = getOracleNodeId(...nodeDefinition);

        const registerTxn = await nodeManager.registerNode(...nodeDefinition);
        await registerTxn.wait();

        const nodeOutput = nodeManager.process(nodeId);
        await expect(nodeOutput).to.revertedWithCustomError(nodeManager, "StalenessToleranceExceeded");
      });
    });
  });
});
