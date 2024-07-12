import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  BridgeMessengerReceiver__factory,
  BridgeMessengerSender__factory,
  BridgeRouterReceiver__factory,
  MockBridgeRouter__factory,
} from "../../typechain-types";
import {
  BYTES32_LENGTH,
  convertEVMAddressToGenericAddress,
  getAccountIdBytes,
  getRandomAddress,
  getRandomBytes,
} from "../utils/bytes";
import {
  MessageParams,
  Finality,
  buildMessagePayload,
  MessageReceived,
  MessageToSend,
} from "../utils/messages/messages";

describe("BridgeMessenger contract (unit tests)", () => {
  const MESSAGE_PARAMS: MessageParams = {
    adapterId: BigInt(0),
    returnAdapterId: BigInt(0),
    receiverValue: BigInt(0),
    gasLimit: BigInt(30000),
    returnGasLimit: BigInt(0),
  };

  async function deployBridgeMessengerSenderFixture() {
    const [user] = await ethers.getSigners();

    // deploy bridge messenger
    const bridgeRouter = await new MockBridgeRouter__factory(user).deploy();
    const bridgeMessenger = await new BridgeMessengerSender__factory(user).deploy(bridgeRouter);

    return { user, bridgeRouter, bridgeMessenger };
  }

  async function deployBridgeMessengerReceiverFixture() {
    const [user] = await ethers.getSigners();

    // deploy bridgeMessenger
    const bridgeRouter = await new BridgeRouterReceiver__factory(user).deploy();
    const bridgeMessenger = await new BridgeMessengerReceiver__factory(user).deploy(bridgeRouter);

    return { user, bridgeRouter, bridgeMessenger };
  }

  describe("Deployment", () => {
    it("Should set bridge router correctly", async () => {
      const { bridgeRouter, bridgeMessenger } = await loadFixture(deployBridgeMessengerSenderFixture);

      // check state
      expect(await bridgeMessenger.getBridgeRouter()).to.equal(bridgeRouter);
    });
  });

  describe("Send Message", () => {
    it("Should successfuly send message passing on fee to bridge router", async () => {
      const { user, bridgeRouter, bridgeMessenger } = await loadFixture(deployBridgeMessengerSenderFixture);

      // before balances
      const userBalance = await ethers.provider.getBalance(user);
      const bridgeMessengerBalance = await ethers.provider.getBalance(bridgeMessenger);
      const bridgeRouterBalance = await ethers.provider.getBalance(bridgeRouter);
      const messageFee = BigInt(50000);

      // send message
      const sourceAddress = convertEVMAddressToGenericAddress(await bridgeMessenger.getAddress());
      const payload = buildMessagePayload(0, getAccountIdBytes("ACCOUNT_ID"), user.address, "0x");
      const handler = convertEVMAddressToGenericAddress(getRandomAddress());
      const message: MessageToSend = {
        params: MESSAGE_PARAMS,
        sender: sourceAddress,
        destinationChainId: BigInt(0),
        handler,
        payload,
        finalityLevel: Finality.IMMEDIATE,
        extraArgs: "0x",
      };
      const sendMessage = await bridgeRouter.sendMessage(message, { value: messageFee });
      const receipt = await ethers.provider.getTransactionReceipt(sendMessage.hash);

      await expect(sendMessage)
        .to.emit(bridgeRouter, "SendMessage")
        .withArgs(Object.values(MESSAGE_PARAMS), sourceAddress, BigInt(0), handler, payload, Finality.IMMEDIATE, "0x");
      expect(await ethers.provider.getBalance(user)).to.be.equal(userBalance - messageFee - receipt!.fee);
      expect(await ethers.provider.getBalance(bridgeMessenger)).to.equal(bridgeMessengerBalance);
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(bridgeRouterBalance + messageFee);
    });
  });

  describe("Receive Message", () => {
    it("Should successfuly call internal receive message in bridge messenger", async () => {
      const { bridgeRouter, bridgeMessenger } = await loadFixture(deployBridgeMessengerReceiverFixture);

      const messageId: string = getRandomBytes(BYTES32_LENGTH);
      const message: MessageReceived = {
        messageId: messageId,
        sourceChainId: BigInt(0),
        sourceAddress: convertEVMAddressToGenericAddress(getRandomAddress()),
        handler: convertEVMAddressToGenericAddress(await bridgeMessenger.getAddress()),
        payload: buildMessagePayload(0, getAccountIdBytes("ACCOUNT_ID"), getRandomAddress(), "0x"),
        returnAdapterId: BigInt(0),
        returnGasLimit: BigInt(0),
      };

      // receive message
      const receiveMessage = bridgeRouter.receiveMessage(message);
      await expect(receiveMessage).to.emit(bridgeMessenger, "ReceiveMessage").withArgs(messageId);
    });
  });

  describe("Reverse Message", () => {
    it("Should successfuly call internal reverse message in bridge messenger", async () => {
      const { bridgeRouter, bridgeMessenger } = await loadFixture(deployBridgeMessengerReceiverFixture);

      const messageId: string = getRandomBytes(BYTES32_LENGTH);
      const message: MessageReceived = {
        messageId: messageId,
        sourceChainId: BigInt(0),
        sourceAddress: convertEVMAddressToGenericAddress(getRandomAddress()),
        handler: convertEVMAddressToGenericAddress(await bridgeMessenger.getAddress()),
        payload: buildMessagePayload(0, getAccountIdBytes("ACCOUNT_ID"), getRandomAddress(), "0x"),
        returnAdapterId: BigInt(0),
        returnGasLimit: BigInt(0),
      };
      const extraArgs = getRandomBytes(BYTES32_LENGTH);

      // reverse message
      const reverseMessage = bridgeRouter.reverseMessage(message, extraArgs);
      await expect(reverseMessage).to.emit(bridgeMessenger, "ReverseMessage").withArgs(messageId, extraArgs);
    });
  });
});
