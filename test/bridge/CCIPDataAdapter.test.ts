import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  BridgeRouterSender__factory,
  CCIPDataAdapter__factory,
  MockCCIPRouterClient__factory,
} from "../../typechain-types";
import {
  BYTES32_LENGTH,
  UINT256_LENGTH,
  abiCoder,
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
  CCIPMessageReceived,
  Finality,
  MessageParams,
  MessageToSend,
  buildMessagePayload,
  encodePayloadWithMetadata,
} from "../utils/messages/messages";
import { SECONDS_IN_DAY } from "../utils/time";

describe("CCIPDataAdapter (unit tests)", () => {
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

  async function deployCCIPDataAdapterFixture() {
    const [user, admin, ...unusedUsers] = await ethers.getSigners();

    // deploy adapter
    const relayer = await new MockCCIPRouterClient__factory(admin).deploy();
    const bridgeRouter = await new BridgeRouterSender__factory(admin).deploy();
    const adapter = await new CCIPDataAdapter__factory(user).deploy(admin, relayer, bridgeRouter);
    await bridgeRouter.setAdapter(adapter);

    return { user, admin, unusedUsers, adapter, relayer, bridgeRouter };
  }

  async function addChainFixture() {
    const { user, admin, unusedUsers, adapter, relayer, bridgeRouter } =
      await loadFixture(deployCCIPDataAdapterFixture);

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
      const { admin, adapter, relayer, bridgeRouter } = await loadFixture(deployCCIPDataAdapterFixture);

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

  describe("Send Messsage", () => {
    it("Should successfuly send message", async () => {
      const { adapter, bridgeRouter, relayer, folksChainId, ccipChainId, corrAdapterAddress } =
        await loadFixture(addChainFixture);

      // balances before
      const adapterBalance = await ethers.provider.getBalance(adapter);
      const relayerBalance = await ethers.provider.getBalance(relayer);

      // get fee
      const message = getMessage(folksChainId);
      const fee = await bridgeRouter.getSendFee(message);

      // set messageId
      const messageId = getRandomBytes(BYTES32_LENGTH);
      await relayer.setMessageId(messageId);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage).to.emit(adapter, "SendMessage").withArgs(messageId, anyValue);
      await expect(sendMessage)
        .to.emit(relayer, "CCIPSend")
        .withArgs(
          ccipChainId,
          abiCoder.encode(["address"], [convertGenericAddressToEVMAddress(corrAdapterAddress)]),
          encodePayloadWithMetadata(message),
          [],
          ethers.ZeroAddress,
          ethers.concat([
            "0x97a657c9",
            abiCoder.encode(["uint256"], [convertNumberToBytes(message.params.gasLimit, UINT256_LENGTH)]),
          ])
        );

      // balances after
      expect(await ethers.provider.getBalance(adapter)).to.equal(adapterBalance);
      expect(await ethers.provider.getBalance(relayer)).to.equal(relayerBalance + fee);
    });

    it("Should fail to send message when chain not added", async () => {
      const { adapter, bridgeRouter } = await loadFixture(deployCCIPDataAdapterFixture);

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

    it("Should fail to send message when receiver value is used", async () => {
      const { adapter, bridgeRouter, folksChainId } = await loadFixture(addChainFixture);

      // get fee
      const message = getMessage(folksChainId);
      message.params.receiverValue = BigInt(1);
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "UnsupportedReceiverValue");
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
      const { adapter, relayer, folksChainId, ccipChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      const message = getMessage(folksChainId);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const ccipMessage: CCIPMessageReceived = {
        messageId,
        sourceChainSelector: BigInt(ccipChainId),
        sender: abiCoder.encode(["address"], [convertGenericAddressToEVMAddress(corrAdapterAddress)]),
        data: encodePayloadWithMetadata(message),
        destTokenAmounts: [],
      };

      // receive message
      const receiveMessage = relayer.deliverToAdapter(adapter, ccipMessage);
      await expect(receiveMessage).to.emit(adapter, "ReceiveMessage").withArgs(messageId);
    });

    it("Should fail to receive message when chain when not added", async () => {
      const { adapter, relayer, folksChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // verify chain unknown
      const ccipChainId = 4;
      expect((await adapter.getChainAdapter(folksChainId))[0]).to.not.equal(ccipChainId);

      const message = getMessage(folksChainId);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const ccipMessage: CCIPMessageReceived = {
        messageId,
        sourceChainSelector: BigInt(ccipChainId),
        sender: abiCoder.encode(["address"], [convertGenericAddressToEVMAddress(corrAdapterAddress)]),
        data: encodePayloadWithMetadata(message),
        destTokenAmounts: [],
      };

      // receive message
      const receiveMessage = relayer.deliverToAdapter(adapter, ccipMessage);
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });

    it("Should fail to receive message when message sender is not corresponding adapter", async () => {
      const { adapter, relayer, folksChainId, ccipChainId } = await loadFixture(addChainFixture);

      // verify sender unknown
      const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());
      expect((await adapter.getChainAdapter(folksChainId))[1]).to.not.equal(corrAdapterAddress);

      // receive message
      const message = getMessage(folksChainId);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const ccipMessage: CCIPMessageReceived = {
        messageId,
        sourceChainSelector: BigInt(ccipChainId),
        sender: abiCoder.encode(["address"], [convertGenericAddressToEVMAddress(corrAdapterAddress)]),
        data: encodePayloadWithMetadata(message),
        destTokenAmounts: [],
      };

      // receive message
      const receiveMessage = relayer.deliverToAdapter(adapter, ccipMessage);
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidMessageSender")
        .withArgs(corrAdapterAddress);
    });

    it("Should fail to receive message when sender is not ccip relayer", async () => {
      const { admin, adapter, folksChainId, ccipChainId, corrAdapterAddress } = await loadFixture(addChainFixture);

      // verify relayer unknown
      const relayer = await new MockCCIPRouterClient__factory(admin).deploy();
      const relayerAddress = await relayer.getAddress();
      expect(await adapter.ccipRouter()).to.not.equal(relayerAddress);

      // receive message
      const message = getMessage(folksChainId);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const ccipMessage: CCIPMessageReceived = {
        messageId,
        sourceChainSelector: BigInt(ccipChainId),
        sender: abiCoder.encode(["address"], [convertGenericAddressToEVMAddress(corrAdapterAddress)]),
        data: encodePayloadWithMetadata(message),
        destTokenAmounts: [],
      };

      // receive message
      const receiveMessage = relayer.deliverToAdapter(adapter, ccipMessage);
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "InvalidRouter").withArgs(relayerAddress);
    });
  });
});
