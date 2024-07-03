import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  BridgeRouterSender__factory,
  CCIPDataAdapter__factory,
  MockCCIPRouterClient__factory,
} from "../../typechain-types";
import {
  BYTES32_LENGTH,
  convertEVMAddressToGenericAddress,
  convertStringToBytes,
  getAccountIdBytes,
  getEmptyBytes,
  getRandomAddress,
} from "../utils/bytes";
import { Finality, MessageParams, MessageToSend, buildMessagePayload } from "../utils/messages/messages";
import { SECONDS_IN_DAY } from "../utils/time";

describe("CCIPAdapter (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const MANAGER_ROLE = ethers.keccak256(convertStringToBytes("MANAGER"));

  const getMessageParams = (): MessageParams => ({
    adapterId: BigInt(0),
    receiverValue: BigInt(0),
    gasLimit: BigInt(30000),
    returnAdapterId: BigInt(0),
    returnGasLimit: BigInt(0),
  });

  const getMessage = (destChainId: number): MessageToSend => ({
    params: getMessageParams(),
    sender: convertEVMAddressToGenericAddress(getRandomAddress()),
    destinationChainId: BigInt(destChainId),
    handler: convertEVMAddressToGenericAddress(getRandomAddress()),
    payload: buildMessagePayload(0, getAccountIdBytes("ACCOUNT_ID"), getRandomAddress(), "0x"),
    finalityLevel: Finality.IMMEDIATE,
    extraArgs: "0x",
  });

  async function deployCCIPAdapterFixture() {
    const [user, admin, ...unusedUsers] = await ethers.getSigners();

    // deploy adapter
    const relayer = await new MockCCIPRouterClient__factory(admin).deploy();
    const bridgeRouter = await new BridgeRouterSender__factory(admin).deploy();
    const adapter = await new CCIPDataAdapter__factory(user).deploy(admin, relayer, bridgeRouter);
    await bridgeRouter.setAdapter(adapter);

    return { user, admin, unusedUsers, adapter, relayer, bridgeRouter };
  }

  async function addChainFixture() {
    const { user, admin, unusedUsers, adapter, relayer, bridgeRouter } = await loadFixture(deployCCIPAdapterFixture);

    // add chain
    const folksChainId = 0;
    const ccipChainId = 5;
    const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());
    await adapter.connect(admin).addChain(folksChainId, ccipChainId, corrAdapterAddress);

    return {
      user,
      admin,
      unusedUsers,
      adapter,
      relayer,
      bridgeRouter,
      folksChainId,
      ccipChainId,
      corrAdapterAddress,
    };
  }

  describe("Deployment", () => {
    it("Should set admin, relayer and bridge router correctly", async () => {
      const { admin, adapter, relayer, bridgeRouter } = await loadFixture(deployCCIPAdapterFixture);

      // check default admin role
      expect(await adapter.owner()).to.equal(admin.address);
      expect(await adapter.defaultAdmin()).to.equal(admin.address);
      expect(await adapter.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await adapter.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await adapter.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check hub manager role
      expect(await adapter.getRoleAdmin(MANAGER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await adapter.hasRole(MANAGER_ROLE, admin.address)).to.be.true;

      // check state
      expect(await adapter.ccipRouter()).to.equal(relayer);
      expect(await adapter.bridgeRouter()).to.equal(bridgeRouter);
    });
  });

  describe("Add Chain", () => {
    it("Should successfully add chain", async () => {
      const { adapter, folksChainId, ccipChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // verfy added
      expect(await adapter.isChainAvailable(folksChainId)).to.be.true;
      expect(await adapter.getChainAdapter(folksChainId)).to.be.eql([BigInt(ccipChainId), corrAdapterAddress]);
    });

    it("Should fail to add chain when sender is not manager", async () => {
      const { user, adapter } = await loadFixture(deployCCIPAdapterFixture);

      const folksChainId = 0;
      const ccipChainId = 5;
      const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());

      // add chain
      const addChain = adapter.connect(user).addChain(folksChainId, ccipChainId, corrAdapterAddress);
      await expect(addChain)
        .to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, MANAGER_ROLE);
    });

    it("Should fail to add chain when already added", async () => {
      const { admin, adapter, folksChainId } = await loadFixture(addChainFixture);

      const ccipChainId = 3;
      const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());

      // verify added
      expect(await adapter.isChainAvailable(folksChainId)).to.be.true;

      // add chain
      const addChain = adapter.connect(admin).addChain(folksChainId, ccipChainId, corrAdapterAddress);
      await expect(addChain).to.be.revertedWithCustomError(adapter, "ChainAlreadyAdded").withArgs(folksChainId);
    });
  });

  describe("Remove Chain", () => {
    it("Should successfully remove chain", async () => {
      const { admin, adapter, folksChainId } = await loadFixture(addChainFixture);

      // remove chain
      await adapter.connect(admin).removeChain(folksChainId);
      expect(await adapter.isChainAvailable(folksChainId)).to.be.false;
    });

    it("Should fail to remove chain when sender is not manager", async () => {
      const { user, adapter, folksChainId } = await loadFixture(addChainFixture);

      // remove chain
      const removeChain = adapter.connect(user).removeChain(folksChainId);
      await expect(removeChain)
        .to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, MANAGER_ROLE);
    });

    it("Should fail to remove chain when not added", async () => {
      const { admin, adapter } = await loadFixture(deployCCIPAdapterFixture);

      // verify not added
      const folksChainId = 0;
      expect(await adapter.isChainAvailable(folksChainId)).to.be.false;

      // remove chain
      const removeChain = adapter.connect(admin).removeChain(folksChainId);
      await expect(removeChain).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });
  });

  describe("Get Chain Adapter", () => {
    it("Should fail when chain not added", async () => {
      const { admin, adapter } = await loadFixture(deployCCIPAdapterFixture);

      // verify not added
      const folksChainId = 0;
      expect(await adapter.isChainAvailable(folksChainId)).to.be.false;

      // get chain adapter
      const getChainAdapter = adapter.connect(admin).getChainAdapter(folksChainId);
      await expect(getChainAdapter).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });
  });

  describe("Get Send Fee", () => {
    it("Should successfuly get send fee", async () => {
      const { adapter, folksChainId } = await loadFixture(addChainFixture);

      const message = getMessage(folksChainId);

      // get send fee
      const fee = await adapter.getSendFee(message);
      expect(fee).to.be.equal(message.params.gasLimit);
    });

    it("Should fail to get send fee when chain not added", async () => {
      const { adapter } = await loadFixture(deployCCIPAdapterFixture);

      // verify not added
      const folksChainId = 0;
      expect(await adapter.isChainAvailable(folksChainId)).to.be.false;
      const message = getMessage(folksChainId);

      // get send fee
      const getSendFee = adapter.getSendFee(message);
      await expect(getSendFee).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });
  });
});
