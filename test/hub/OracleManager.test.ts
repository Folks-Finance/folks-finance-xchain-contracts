import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { MockNodeManager__factory, OracleManager__factory } from "../../typechain-types";
import { BYTES32_LENGTH, convertStringToBytes, getEmptyBytes, getRandomBytes } from "../utils/bytes";
import { unixTime } from "./utils/formulae";
import { SECONDS_IN_DAY } from "../utils/time";
import { NodeOutputData, NodeType } from "./libraries/assets/oracleData";

describe("OracleManager (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const MANAGER_ROLE = ethers.keccak256(convertStringToBytes("MANAGER"));

  async function deployOracleManagerFixture() {
    const [admin, user, ...unusedUsers] = await ethers.getSigners();

    // deploy contract
    const nodeManager = await new MockNodeManager__factory(user).deploy();
    const oracleManager = await new OracleManager__factory(user).deploy(admin, nodeManager);

    return { admin, user, unusedUsers, oracleManager, nodeManager };
  }

  async function setNodeIdFixture() {
    const { admin, user, unusedUsers, oracleManager, nodeManager } = await loadFixture(deployOracleManagerFixture);

    // set node id
    const poolId = 1;
    const nodeId = getRandomBytes(BYTES32_LENGTH);
    const decimals = BigInt(18);
    const setNodeId = await oracleManager.connect(admin).setNodeId(poolId, nodeId, decimals);

    return { admin, user, unusedUsers, oracleManager, setNodeId, nodeManager, poolId, nodeId, decimals };
  }

  describe("Deployment", () => {
    it("Should set default admin and spoke role correctly", async () => {
      const { admin, oracleManager, nodeManager } = await loadFixture(deployOracleManagerFixture);

      // check default admin role
      expect(await oracleManager.owner()).to.equal(admin.address);
      expect(await oracleManager.defaultAdmin()).to.equal(admin.address);
      expect(await oracleManager.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await oracleManager.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await oracleManager.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check manager
      expect(await oracleManager.getRoleAdmin(MANAGER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await oracleManager.hasRole(MANAGER_ROLE, admin.address)).to.be.true;

      // set node manager
      expect(await oracleManager.getNodeManager()).to.equal(nodeManager);
    });

    it("Should fail when address passed doesn't support node manager", async () => {
      const [admin, user] = await ethers.getSigners();

      // doesn't support node manager
      const nodeManager = await new MockNodeManager__factory(user).deploy();
      await nodeManager.setSupportsInterface(false);

      // deploy contract
      const oracleManager = new OracleManager__factory(user);
      const deploy = oracleManager.deploy(admin, nodeManager);
      await expect(deploy).to.be.revertedWithCustomError(oracleManager, "InvalidNodeManager").withArgs(nodeManager);
    });
  });

  describe("Set Node Manager", () => {
    it("Should successfuly set node manager", async () => {
      const { admin, user, oracleManager } = await loadFixture(deployOracleManagerFixture);

      // set node manager
      const nodeManager = await new MockNodeManager__factory(user).deploy();
      const setNodeManager = await oracleManager.connect(admin).setNodeManager(nodeManager);
      await expect(setNodeManager).to.emit(oracleManager, "NodeManagerSet").withArgs(nodeManager);
      expect(await oracleManager.getNodeManager()).to.equal(nodeManager);
    });

    it("Should fail to set node manager when sender is not manager admin", async () => {
      const { user, oracleManager } = await loadFixture(deployOracleManagerFixture);

      // set node manager
      const nodeManager = await new MockNodeManager__factory(user).deploy();
      const setNodeManager = oracleManager.connect(user).setNodeManager(nodeManager);
      await expect(setNodeManager)
        .to.be.revertedWithCustomError(oracleManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, MANAGER_ROLE);
    });
  });

  describe("Set Node Id", () => {
    it("Should successfuly set node id", async () => {
      const { oracleManager, setNodeId, poolId, nodeId, decimals } = await loadFixture(setNodeIdFixture);

      // verify node id set
      expect(await oracleManager.poolIdToNode(poolId)).to.deep.equal([nodeId, decimals]);
      await expect(setNodeId).to.emit(oracleManager, "NodeIdSetForPool").withArgs(nodeId, poolId);
    });

    it("Should fail to set node id when process fails", async () => {
      const { admin, oracleManager, nodeManager } = await loadFixture(deployOracleManagerFixture);

      // process to fail
      await nodeManager.setThrowsErrorOnProcess(true);

      // set node id
      const poolId = 1;
      const nodeId = getRandomBytes(BYTES32_LENGTH);
      const decimals = 18;
      const setNodeId = oracleManager.connect(admin).setNodeId(poolId, nodeId, decimals);
      await expect(setNodeId).to.be.revertedWithCustomError(nodeManager, "CannotProcess");
    });

    it("Should fail to set node id when sender is not manager admin", async () => {
      const { user, oracleManager } = await loadFixture(deployOracleManagerFixture);

      // set node id
      const poolId = 1;
      const nodeId = getRandomBytes(BYTES32_LENGTH);
      const decimals = 18;
      const setNodeId = oracleManager.connect(user).setNodeId(poolId, nodeId, decimals);
      await expect(setNodeId)
        .to.be.revertedWithCustomError(oracleManager, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, MANAGER_ROLE);
    });
  });

  describe("Process Price Feed", () => {
    it("Should successfuly process price feed", async () => {
      const { oracleManager, nodeManager, poolId, decimals } = await loadFixture(setNodeIdFixture);

      // set node data
      const nodeOutputData: NodeOutputData = {
        price: BigInt(0.5e14),
        timestamp: BigInt(unixTime() - SECONDS_IN_DAY),
        nodeType: NodeType.CHAINLINK,
        additionalParam1: BigInt(1),
        additionalParam2: BigInt(2),
      };
      await nodeManager.setNodeOutput(nodeOutputData);

      // process price feed
      const priceFeed = await oracleManager.processPriceFeed(poolId);
      expect(priceFeed).to.deep.equal([nodeOutputData.price, decimals]);
    });

    it("Should fail to process price feed when unknown pool", async () => {
      const { oracleManager } = await loadFixture(deployOracleManagerFixture);

      // process price feed
      const poolId = 1;
      const processFeed = oracleManager.processPriceFeed(poolId);
      await expect(processFeed).to.be.revertedWithCustomError(oracleManager, "NoNodeIdForPool").withArgs(poolId);
    });
  });
});
