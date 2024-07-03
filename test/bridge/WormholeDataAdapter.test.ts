import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  BridgeRouterSender__factory,
  MockWormholeRelayer__factory,
  WormholeDataAdapter__factory,
} from "../../typechain-types";
import {
  BYTES32_LENGTH,
  convertEVMAddressToGenericAddress,
  convertGenericAddressToEVMAddress,
  convertNumberToBytes,
  convertStringToBytes,
  getAccountIdBytes,
  getEmptyBytes,
  getRandomAddress,
  getRandomBytes,
} from "../utils/bytes";
import {
  Finality,
  MessageParams,
  MessageToSend,
  buildMessagePayload,
  encodePayloadWithMetadata,
} from "../utils/messages/messages";
import { SECONDS_IN_DAY, getRandomInt } from "../utils/time";
import { WormholeFinality } from "../utils/wormhole";

describe("WormholeDataAdapter (unit tests)", () => {
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

  async function deployWormholeDataAdapterFixture() {
    const [user, admin, ...unusedUsers] = await ethers.getSigners();

    // deploy adapter
    const relayer = await new MockWormholeRelayer__factory(admin).deploy();
    const bridgeRouter = await new BridgeRouterSender__factory(admin).deploy();
    const refundAddress = getRandomAddress();
    const adapter = await new WormholeDataAdapter__factory(user).deploy(admin, relayer, bridgeRouter, refundAddress);
    await bridgeRouter.setAdapter(adapter);

    return { user, admin, unusedUsers, adapter, relayer, bridgeRouter, refundAddress };
  }

  async function addChainFixture() {
    const { user, admin, unusedUsers, adapter, relayer, bridgeRouter, refundAddress } = await loadFixture(
      deployWormholeDataAdapterFixture
    );

    // add chain
    const folksChainId = 0;
    const wormholeChainId = 5;
    const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());
    await adapter.connect(admin).addChain(folksChainId, wormholeChainId, corrAdapterAddress);

    return {
      user,
      admin,
      unusedUsers,
      adapter,
      relayer,
      bridgeRouter,
      refundAddress,
      folksChainId,
      wormholeChainId,
      corrAdapterAddress,
    };
  }

  describe("Deployment", () => {
    it("Should set admin, relayer and bridge router correctly", async () => {
      const { admin, adapter, relayer, bridgeRouter, refundAddress } = await loadFixture(
        deployWormholeDataAdapterFixture
      );

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
      expect(await adapter.wormholeRelayer()).to.equal(relayer);
      expect(await adapter.bridgeRouter()).to.equal(bridgeRouter);
      expect(await adapter.refundAddress()).to.equal(refundAddress);
    });
  });

  describe("Set Refund Address", () => {
    it("Should successfully set refund address", async () => {
      const { admin, adapter } = await loadFixture(deployWormholeDataAdapterFixture);

      // set refund address
      const refundAddress = getRandomAddress();
      await adapter.connect(admin).setRefundAddress(refundAddress);
      expect(await adapter.refundAddress()).to.equal(refundAddress);
    });

    it("Should fail to set refund address when sender is not manager", async () => {
      const { user, adapter } = await loadFixture(deployWormholeDataAdapterFixture);

      const refundAddress = getRandomAddress();

      // set refund address
      const setRefundAddress = adapter.connect(user).setRefundAddress(refundAddress);
      await expect(setRefundAddress)
        .to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, MANAGER_ROLE);
    });
  });

  describe("Add Chain", () => {
    it("Should successfully add chain", async () => {
      const { adapter, folksChainId, wormholeChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // verfy added
      expect(await adapter.isChainAvailable(folksChainId)).to.be.true;
      expect(await adapter.getChainAdapter(folksChainId)).to.be.eql([BigInt(wormholeChainId), corrAdapterAddress]);
    });

    it("Should fail to add chain when sender is not manager", async () => {
      const { user, adapter } = await loadFixture(deployWormholeDataAdapterFixture);

      const folksChainId = 0;
      const wormholeChainId = 5;
      const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());

      // add chain
      const addChain = adapter.connect(user).addChain(folksChainId, wormholeChainId, corrAdapterAddress);
      await expect(addChain)
        .to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, MANAGER_ROLE);
    });

    it("Should fail to add chain when already added", async () => {
      const { admin, adapter, folksChainId } = await loadFixture(addChainFixture);

      const wormholeChainId = 3;
      const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());

      // verify added
      expect(await adapter.isChainAvailable(folksChainId)).to.be.true;

      // add chain
      const addChain = adapter.connect(admin).addChain(folksChainId, wormholeChainId, corrAdapterAddress);
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
      const { admin, adapter } = await loadFixture(deployWormholeDataAdapterFixture);

      // verify not added
      const folksChainId = 0;
      expect(await adapter.isChainAvailable(folksChainId)).to.be.false;

      // add chain
      const removeChain = adapter.connect(admin).removeChain(folksChainId);
      await expect(removeChain).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });
  });

  describe("Get Chain Adapter", () => {
    it("Should fail when chain not added", async () => {
      const { admin, adapter } = await loadFixture(deployWormholeDataAdapterFixture);

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
      expect(fee).to.be.equal(message.params.receiverValue + message.params.gasLimit);
    });

    it("Should fail to get send fee when chain not added", async () => {
      const { adapter } = await loadFixture(deployWormholeDataAdapterFixture);

      // verify not added
      const folksChainId = 0;
      expect(await adapter.isChainAvailable(folksChainId)).to.be.false;
      const message = getMessage(folksChainId);

      // get send fee
      const getSendFee = adapter.getSendFee(message);
      await expect(getSendFee).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });
  });

  describe("Send Messsage", () => {
    it("Should successfuly send immediate finality message", async () => {
      const { adapter, bridgeRouter, refundAddress, relayer, folksChainId, wormholeChainId, corrAdapterAddress } =
        await loadFixture(addChainFixture);

      // balances before
      const adapterBalance = await ethers.provider.getBalance(adapter);
      const relayerBalance = await ethers.provider.getBalance(relayer);

      // get fee
      const message = getMessage(folksChainId);
      message.finalityLevel = Finality.IMMEDIATE;
      const fee = await bridgeRouter.getSendFee(message);

      // set sequence
      const sequence = getRandomInt(1000);
      await relayer.setSequence(sequence);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage)
        .to.emit(adapter, "SendMessage")
        .withArgs(convertNumberToBytes(sequence, BYTES32_LENGTH), anyValue);
      await expect(sendMessage)
        .to.emit(relayer, "WormholeSendVaaKey")
        .withArgs(
          wormholeChainId,
          convertGenericAddressToEVMAddress(corrAdapterAddress),
          encodePayloadWithMetadata(message),
          message.params.receiverValue,
          0,
          message.params.gasLimit,
          wormholeChainId,
          refundAddress,
          ethers.ZeroAddress,
          [],
          WormholeFinality.INSTANT
        );

      // balances after
      expect(await ethers.provider.getBalance(adapter)).to.equal(adapterBalance);
      expect(await ethers.provider.getBalance(relayer)).to.equal(relayerBalance + fee);
    });

    it("Should successfuly send finalised finality message", async () => {
      const { adapter, bridgeRouter, refundAddress, relayer, folksChainId, wormholeChainId, corrAdapterAddress } =
        await loadFixture(addChainFixture);

      // get fee
      const message = getMessage(folksChainId);
      message.finalityLevel = Finality.FINALISED;
      const fee = await bridgeRouter.getSendFee(message);

      // set sequence
      const sequence = getRandomInt(1000);
      await relayer.setSequence(sequence);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage)
        .to.emit(adapter, "SendMessage")
        .withArgs(convertNumberToBytes(sequence, BYTES32_LENGTH), anyValue);
      await expect(sendMessage)
        .to.emit(relayer, "WormholeSendVaaKey")
        .withArgs(
          wormholeChainId,
          convertGenericAddressToEVMAddress(corrAdapterAddress),
          encodePayloadWithMetadata(message),
          message.params.receiverValue,
          0,
          message.params.gasLimit,
          wormholeChainId,
          refundAddress,
          ethers.ZeroAddress,
          [],
          WormholeFinality.FINALIZED
        );
    });

    it("Should fail to send message when chain not added", async () => {
      const { adapter, bridgeRouter } = await loadFixture(deployWormholeDataAdapterFixture);

      // verify not added
      const folksChainId = 0;
      expect(await adapter.isChainAvailable(folksChainId)).to.be.false;

      // get fee
      const message = getMessage(folksChainId);
      const fee = 10000;

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });

    it("Should fail to send message when sender is not bridge router", async () => {
      const { user, adapter, folksChainId } = await loadFixture(addChainFixture);

      // get fee
      const message = getMessage(folksChainId);
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = adapter.connect(user).sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "InvalidBridgeRouter").withArgs(user.address);
    });

    it("Should fail to send message when extra args is used", async () => {
      const { adapter, bridgeRouter, folksChainId } = await loadFixture(addChainFixture);

      // get fee
      const message = getMessage(folksChainId);
      message.extraArgs = "0x00";
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "UnsupportedExtraArgs");
    });
  });

  describe("Receive Message", () => {
    it("Should successfuly receive message", async () => {
      const { adapter, relayer, bridgeRouter, folksChainId, wormholeChainId, corrAdapterAddress } =
        await loadFixture(addChainFixture);

      // balances before
      const adapterBalance = await ethers.provider.getBalance(adapter);
      const bridgeRouterBalance = await ethers.provider.getBalance(bridgeRouter);

      // construct message
      const message = getMessage(folksChainId);
      const messageId = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const receiverValue = BigInt(30000);
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithMetadata(message),
        [],
        corrAdapterAddress,
        wormholeChainId,
        messageId,
        { value: receiverValue }
      );
      await expect(receiveMessage)
        .to.emit(adapter, "ReceiveMessage(bytes32,bytes32)")
        .withArgs(messageId, corrAdapterAddress);

      // balances after
      expect(await ethers.provider.getBalance(adapter)).to.equal(adapterBalance);
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(bridgeRouterBalance + receiverValue);
    });

    it("Should fail to receive message when chain when not added", async () => {
      const { adapter, relayer, folksChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // verify chain unknown
      const wormholeChainId = 4;
      expect((await adapter.getChainAdapter(folksChainId))[0]).to.not.equal(wormholeChainId);

      const message = getMessage(folksChainId);
      const messageId = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithMetadata(message),
        [],
        corrAdapterAddress,
        wormholeChainId,
        messageId
      );
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });

    it("Should fail to receive message when message sender is not corresponding adapter", async () => {
      const { adapter, relayer, folksChainId, wormholeChainId } = await loadFixture(addChainFixture);

      // verify sender unknown
      const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());
      expect((await adapter.getChainAdapter(folksChainId))[1]).to.not.equal(corrAdapterAddress);

      // receive message
      const message = getMessage(folksChainId);
      const messageId = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithMetadata(message),
        [],
        corrAdapterAddress,
        wormholeChainId,
        messageId
      );
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidMessageSender")
        .withArgs(corrAdapterAddress);
    });

    it("Should fail to receive message when sender is not wormhole relayer", async () => {
      const { admin, adapter, folksChainId, wormholeChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // verify relayer unknown
      const relayer = await new MockWormholeRelayer__factory(admin).deploy();
      const relayerAddress = await relayer.getAddress();
      expect(await adapter.wormholeRelayer()).to.not.equal(relayerAddress);

      // receive message
      const message = getMessage(folksChainId);
      const messageId = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithMetadata(message),
        [],
        corrAdapterAddress,
        wormholeChainId,
        messageId
      );
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidWormholeRelayer")
        .withArgs(relayerAddress);
    });
  });
});
