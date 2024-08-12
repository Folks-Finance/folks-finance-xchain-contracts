import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  BridgeMessengerReceiver__factory,
  BridgeRouterHub__factory,
  MockAdapter__factory,
} from "../../typechain-types";
import {
  BYTES32_LENGTH,
  convertEVMAddressToGenericAddress,
  convertStringToBytes,
  getAccountIdBytes,
  getEmptyBytes,
  getRandomAddress,
  getRandomBytes,
} from "../utils/bytes";
import {
  Finality,
  MessageParams,
  MessageReceived,
  MessageToSend,
  buildMessagePayload,
  getMessageReceivedHash,
} from "../utils/messages/messages";
import { SECONDS_IN_DAY } from "../utils/time";

describe("BridgeRouter (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const MANAGER_ROLE = ethers.keccak256(convertStringToBytes("MANAGER"));
  const MESSAGE_SENDER_ROLE = ethers.keccak256(convertStringToBytes("MESSAGE_SENDER"));

  const getMessageParams = (adapterId: bigint): MessageParams => ({
    adapterId,
    receiverValue: BigInt(0),
    gasLimit: BigInt(300000),
    returnAdapterId: BigInt(0),
    returnGasLimit: BigInt(0),
  });
  const accountId: string = getAccountIdBytes("ACCOUNT_ID");

  async function deployBridgeRouterFixture() {
    const [admin, messager, user, ...unusedUsers] = await ethers.getSigners();

    // deploy contract
    const bridgeRouter = await new BridgeRouterHub__factory(user).deploy(admin.address);
    const bridgeRouterAddress = await bridgeRouter.getAddress();

    // add messager
    await bridgeRouter.connect(admin).grantRole(MESSAGE_SENDER_ROLE, messager);

    return { admin, messager, user, unusedUsers, bridgeRouter, bridgeRouterAddress };
  }

  async function addAdapterFixture() {
    const { admin, messager, unusedUsers, bridgeRouter, bridgeRouterAddress } =
      await loadFixture(deployBridgeRouterFixture);

    // deploy and add adapter
    const adapter = await new MockAdapter__factory(admin).deploy(bridgeRouterAddress);
    const adapterId = 0;
    const adapterAddress = await adapter.getAddress();
    await bridgeRouter.connect(admin).addAdapter(adapterId, adapterAddress);

    return {
      admin,
      messager,
      unusedUsers,
      bridgeRouter,
      bridgeRouterAddress,
      adapter,
      adapterId,
      adapterAddress,
    };
  }

  async function deployBridgeMessengerFixture() {
    const { admin, messager, unusedUsers, bridgeRouter, bridgeRouterAddress, adapter, adapterId, adapterAddress } =
      await loadFixture(addAdapterFixture);

    // deploy messenger and sender
    const bridgeMessenger = await new BridgeMessengerReceiver__factory(admin).deploy(bridgeRouter);

    // common params
    const bridgeMessengerAddress = await bridgeMessenger.getAddress();

    return {
      admin,
      messager,
      unusedUsers,
      bridgeRouter,
      bridgeRouterAddress,
      adapter,
      adapterId,
      adapterAddress,
      bridgeMessenger,
      bridgeMessengerAddress,
    };
  }

  async function deployFailedMessageFixture() {
    const {
      admin,
      messager,
      unusedUsers,
      bridgeRouter,
      bridgeRouterAddress,
      adapter,
      adapterId,
      adapterAddress,
      bridgeMessenger,
      bridgeMessengerAddress,
    } = await loadFixture(deployBridgeMessengerFixture);
    const sender = unusedUsers[0];

    // set handler to fail
    await bridgeMessenger.setShouldFail(true);

    // receive message
    const message: MessageReceived = {
      messageId: getRandomBytes(BYTES32_LENGTH),
      sourceChainId: BigInt(0),
      sourceAddress: convertEVMAddressToGenericAddress(adapterAddress),
      handler: convertEVMAddressToGenericAddress(bridgeMessengerAddress),
      payload: buildMessagePayload(0, accountId, sender.address, "0x"),
      returnAdapterId: BigInt(0),
      returnGasLimit: BigInt(0),
    };
    const balance = BigInt(30000);
    const receiveMessage = await adapter.receiveMessage(message, { value: balance });

    return {
      admin,
      messager,
      unusedUsers,
      bridgeRouter,
      bridgeRouterAddress,
      adapter,
      adapterId,
      adapterAddress,
      bridgeMessenger,
      bridgeMessengerAddress,
      message,
      balance,
      receiveMessage,
    };
  }

  describe("Deployment", () => {
    it("Should set default admin and manager roles correctly", async () => {
      const { admin, bridgeRouter } = await loadFixture(deployBridgeRouterFixture);

      // check default admin role
      expect(await bridgeRouter.owner()).to.equal(admin.address);
      expect(await bridgeRouter.defaultAdmin()).to.equal(admin.address);
      expect(await bridgeRouter.defaultAdminDelay()).to.equal(SECONDS_IN_DAY);
      expect(await bridgeRouter.getRoleAdmin(DEFAULT_ADMIN_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await bridgeRouter.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;

      // check manager
      expect(await bridgeRouter.getRoleAdmin(MANAGER_ROLE)).to.equal(DEFAULT_ADMIN_ROLE);
      expect(await bridgeRouter.hasRole(MANAGER_ROLE, admin.address)).to.be.true;
    });
  });

  describe("Add Adapter", () => {
    it("Should successfully add adapter", async () => {
      const { bridgeRouter, adapterId, adapterAddress } = await loadFixture(addAdapterFixture);

      // verify adapter was added
      expect(await bridgeRouter.isAdapterInitialized(adapterId)).to.be.true;
      expect(await bridgeRouter.idToAdapter(adapterId)).to.equal(adapterAddress);
      expect(await bridgeRouter.adapterToId(adapterAddress)).to.equal(adapterId);
    });

    it("Should fail to add adapter when sender is not manager", async () => {
      const { unusedUsers, bridgeRouter } = await loadFixture(deployBridgeRouterFixture);
      const sender = unusedUsers[0];

      const adapterId = 0;
      const adapterAddress = getRandomAddress();

      // add adapter
      const addAdapter = bridgeRouter.connect(sender).addAdapter(adapterId, adapterAddress);
      expect(addAdapter)
        .to.be.revertedWithCustomError(bridgeRouter, "AccessControlUnauthorizedAccount")
        .withArgs(sender.address, MANAGER_ROLE);
    });

    it("Should fail to add adapter when zero address", async () => {
      const { bridgeRouter } = await loadFixture(deployBridgeRouterFixture);

      const adapterId = 0;
      const adapterAddress = ethers.ZeroAddress;
      const addAdapter = bridgeRouter.addAdapter(adapterId, adapterAddress);
      expect(addAdapter).to.be.revertedWithCustomError(bridgeRouter, "ZeroAddressAdapter");
    });

    it("Should fail to add adapter when already added", async () => {
      const { bridgeRouter, adapterId } = await loadFixture(addAdapterFixture);

      // verify adapter is added
      expect(await bridgeRouter.isAdapterInitialized(adapterId)).to.be.true;

      // add adapter
      const adapterAddress = getRandomAddress();
      const addAdapter = bridgeRouter.addAdapter(adapterId, adapterAddress);
      expect(addAdapter).to.be.revertedWithCustomError(bridgeRouter, "AdapterInitialized").withArgs(adapterId);
    });
  });

  describe("Remove Adapter", () => {
    it("Should successfully remove adapter", async () => {
      const { admin, bridgeRouter, adapterId, adapterAddress } = await loadFixture(addAdapterFixture);

      // remove adapter
      await bridgeRouter.connect(admin).removeAdapter(adapterId);
      expect(await bridgeRouter.isAdapterInitialized(adapterId)).to.be.false;
      expect(await bridgeRouter.idToAdapter(adapterId)).to.equal(ethers.ZeroAddress);
      expect(await bridgeRouter.adapterToId(adapterAddress)).to.equal(0);
    });

    it("Should fail to remove adapter when sender is not manager", async () => {
      const { unusedUsers, bridgeRouter, adapterId } = await loadFixture(addAdapterFixture);
      const sender = unusedUsers[0];

      // remove adapter
      const removeAdapter = bridgeRouter.connect(sender).removeAdapter(adapterId);
      await expect(removeAdapter)
        .to.be.revertedWithCustomError(bridgeRouter, "AccessControlUnauthorizedAccount")
        .withArgs(sender.address, MANAGER_ROLE);
    });

    it("Should fail to remove adapter when not added", async () => {
      const { admin, bridgeRouter } = await loadFixture(deployBridgeRouterFixture);

      // verify adapter is not added
      const adapterId = 0;
      expect(await bridgeRouter.isAdapterInitialized(adapterId)).to.be.false;

      // remove adapter
      const removeAdapter = bridgeRouter.connect(admin).removeAdapter(adapterId);
      await expect(removeAdapter)
        .to.be.revertedWithCustomError(bridgeRouter, "AdapterNotInitialized")
        .withArgs(adapterId);
    });
  });

  describe("Get adapter", () => {
    it("Should successfully get adapter", async () => {
      const { bridgeRouter, adapterId, adapterAddress } = await loadFixture(addAdapterFixture);
      expect(await bridgeRouter.getAdapter(adapterId)).to.equal(adapterAddress);
    });

    it("Should fail to get adapter when not added", async () => {
      const { bridgeRouter } = await loadFixture(deployBridgeRouterFixture);

      // verify adapter is not added
      const adapterId = 0;
      expect(await bridgeRouter.isAdapterInitialized(adapterId)).to.be.false;

      // get adatper
      const getAdapter = bridgeRouter.getAdapter(adapterId);
      await expect(getAdapter).to.be.revertedWithCustomError(bridgeRouter, "AdapterNotInitialized").withArgs(adapterId);
    });
  });

  describe("Get Send Fee", () => {
    it("Should successfully get send fee", async () => {
      const { unusedUsers, bridgeRouter, adapterId } = await loadFixture(addAdapterFixture);
      const sender = unusedUsers[0];
      const senderAddress = convertEVMAddressToGenericAddress(sender.address);

      const message: MessageToSend = {
        params: getMessageParams(BigInt(adapterId)),
        sender: senderAddress,
        destinationChainId: BigInt(0),
        handler: convertEVMAddressToGenericAddress(getRandomAddress()),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        finalityLevel: Finality.IMMEDIATE,
        extraArgs: "0x",
      };

      // get send fee
      const fee = await bridgeRouter.connect(sender).getSendFee(message);
      expect(fee).to.be.equal(message.params.gasLimit);
    });

    it("Should fail to get send fee when adapter not added", async () => {
      const { unusedUsers, bridgeRouter } = await loadFixture(deployBridgeRouterFixture);
      const sender = unusedUsers[0];
      const senderAddress = convertEVMAddressToGenericAddress(sender.address);

      // verify adapter is not added
      const adapterId = 0;
      expect(await bridgeRouter.isAdapterInitialized(adapterId)).to.be.false;

      const message: MessageToSend = {
        params: getMessageParams(BigInt(adapterId)),
        sender: senderAddress,
        destinationChainId: BigInt(0),
        handler: convertEVMAddressToGenericAddress(getRandomAddress()),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        finalityLevel: Finality.IMMEDIATE,
        extraArgs: "0x",
      };

      // get send fee
      const getSendFee = bridgeRouter.connect(sender).getSendFee(message);
      await expect(getSendFee).to.be.revertedWithCustomError(bridgeRouter, "AdapterNotInitialized").withArgs(adapterId);
    });
  });

  describe("Send Message", () => {
    it("Should successfully send message using message value", async () => {
      const { messager: sender, bridgeRouter, adapter, adapterId } = await loadFixture(addAdapterFixture);
      const senderAddress = convertEVMAddressToGenericAddress(sender.address);

      // verify balance is zero
      expect(await bridgeRouter.balances(senderAddress)).to.be.equal(0);
      const adapterBalance = await ethers.provider.getBalance(adapter);

      const message: MessageToSend = {
        params: getMessageParams(BigInt(adapterId)),
        sender: senderAddress,
        destinationChainId: BigInt(0),
        handler: convertEVMAddressToGenericAddress(getRandomAddress()),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        finalityLevel: Finality.IMMEDIATE,
        extraArgs: "0x",
      };

      // get send fee
      const fee = await bridgeRouter.getSendFee(message);

      // send message
      const sendMessage = bridgeRouter.connect(sender).sendMessage(message, { value: fee });
      await expect(sendMessage).to.emit(adapter, "SendMessage");
      expect(await bridgeRouter.balances(senderAddress)).to.be.equal(0);
      expect(await ethers.provider.getBalance(adapter)).to.be.equal(adapterBalance + fee);
    });

    it("Should successfully send message using existing balance", async () => {
      const { messager: sender, bridgeRouter, adapter, adapterId } = await loadFixture(addAdapterFixture);
      const senderAddress = convertEVMAddressToGenericAddress(sender.address);

      const message: MessageToSend = {
        params: getMessageParams(BigInt(adapterId)),
        sender: senderAddress,
        destinationChainId: BigInt(0),
        handler: convertEVMAddressToGenericAddress(getRandomAddress()),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        finalityLevel: Finality.IMMEDIATE,
        extraArgs: "0x",
      };

      // verify balance is zero
      expect(await bridgeRouter.balances(senderAddress)).to.be.equal(0);
      const adapterBalance = await ethers.provider.getBalance(adapter);

      // increase balance
      message.params.gasLimit = BigInt(0);
      expect(await bridgeRouter.getSendFee(message)).to.equal(0);
      const startingBalance = BigInt(50000);
      await bridgeRouter.connect(sender).sendMessage(message, { value: startingBalance });
      expect(await bridgeRouter.balances(accountId)).to.be.equal(startingBalance);

      // get send fee
      const fee = BigInt(30000);
      message.params.gasLimit = fee;
      expect(await bridgeRouter.getSendFee(message)).to.equal(fee);

      // send message
      const sendMessage = await bridgeRouter.connect(sender).sendMessage(message);
      await expect(sendMessage).to.emit(adapter, "SendMessage");
      expect(await bridgeRouter.balances(accountId)).to.be.equal(startingBalance - fee);
      expect(await ethers.provider.getBalance(adapter)).to.be.equal(adapterBalance + fee);
    });

    it("Should successfully send message using combinatiom of existing balance and message value", async () => {
      const { messager: sender, bridgeRouter, adapter, adapterId } = await loadFixture(addAdapterFixture);
      const senderAddress = convertEVMAddressToGenericAddress(sender.address);

      const message: MessageToSend = {
        params: getMessageParams(BigInt(adapterId)),
        sender: senderAddress,
        destinationChainId: BigInt(0),
        handler: convertEVMAddressToGenericAddress(getRandomAddress()),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        finalityLevel: Finality.IMMEDIATE,
        extraArgs: "0x",
      };

      // verify balance is zero
      expect(await bridgeRouter.balances(accountId)).to.be.equal(0);
      const adapterBalance = await ethers.provider.getBalance(bridgeRouter);

      // increase balance
      message.params.gasLimit = BigInt(0);
      expect(await bridgeRouter.getSendFee(message)).to.equal(0);
      const startingBalance = BigInt(30000);
      await bridgeRouter.connect(sender).sendMessage(message, { value: startingBalance });
      expect(await bridgeRouter.balances(accountId)).to.be.equal(startingBalance);
      expect(await ethers.provider.getBalance(bridgeRouter)).to.be.equal(adapterBalance + startingBalance);

      // get send fee
      const fee = BigInt(50000);
      message.params.gasLimit = fee;
      expect(await bridgeRouter.getSendFee(message)).to.be.equal(fee);

      // send message
      const sendMessage = await bridgeRouter.connect(sender).sendMessage(message, { value: fee - startingBalance });
      await expect(sendMessage).to.emit(adapter, "SendMessage");
      expect(await bridgeRouter.balances(accountId)).to.be.equal(0);
      expect(await ethers.provider.getBalance(adapter)).to.be.equal(adapterBalance + fee);
    });

    it("Should fail to send message when insuffient funds", async () => {
      const { messager: sender, bridgeRouter, adapterId } = await loadFixture(addAdapterFixture);
      const senderAddress = convertEVMAddressToGenericAddress(sender.address);

      const message: MessageToSend = {
        params: getMessageParams(BigInt(adapterId)),
        sender: senderAddress,
        destinationChainId: BigInt(0),
        handler: convertEVMAddressToGenericAddress(getRandomAddress()),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        finalityLevel: Finality.IMMEDIATE,
        extraArgs: "0x",
      };

      // verify balance is zero
      expect(await bridgeRouter.balances(accountId)).to.be.equal(0);

      // get send fee
      const fee = message.params.gasLimit;
      expect(await bridgeRouter.getSendFee(message)).to.be.equal(fee);

      // send message
      const sendMessage = bridgeRouter.connect(sender).sendMessage(message, { value: fee - BigInt(1) });
      await expect(sendMessage).to.be.revertedWithCustomError(bridgeRouter, "NotEnoughFunds").withArgs(accountId);
    });

    it("Should fail to send message when adapter not added", async () => {
      const { messager: sender, bridgeRouter } = await loadFixture(deployBridgeRouterFixture);
      const senderAddress = convertEVMAddressToGenericAddress(sender.address);

      // verify adapter is not added
      const adapterId = 0;
      expect(await bridgeRouter.isAdapterInitialized(adapterId)).to.be.false;

      const message: MessageToSend = {
        params: getMessageParams(BigInt(adapterId)),
        sender: senderAddress,
        destinationChainId: BigInt(0),
        handler: convertEVMAddressToGenericAddress(getRandomAddress()),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        finalityLevel: Finality.IMMEDIATE,
        extraArgs: "0x",
      };

      // send message
      const sendMessage = bridgeRouter.connect(sender).sendMessage(message);
      await expect(sendMessage)
        .to.be.revertedWithCustomError(bridgeRouter, "AdapterNotInitialized")
        .withArgs(adapterId);
    });

    it("Should fail to send message when sender does not match caller", async () => {
      const { messager: actualSender, unusedUsers, bridgeRouter, adapterId } = await loadFixture(addAdapterFixture);
      const sender = unusedUsers[0];
      const senderAddress = convertEVMAddressToGenericAddress(sender.address);

      const message: MessageToSend = {
        params: getMessageParams(BigInt(adapterId)),
        sender: senderAddress,
        destinationChainId: BigInt(0),
        handler: convertEVMAddressToGenericAddress(getRandomAddress()),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        finalityLevel: Finality.IMMEDIATE,
        extraArgs: "0x",
      };

      // send message
      const sendMessage = bridgeRouter.connect(actualSender).sendMessage(message);
      await expect(sendMessage)
        .to.be.revertedWithCustomError(bridgeRouter, "SenderDoesNotMatch")
        .withArgs(sender.address, actualSender.address);
    });

    it("Should fail to send message when sender is not messager", async () => {
      const { unusedUsers, bridgeRouter, adapterId } = await loadFixture(addAdapterFixture);
      const sender = unusedUsers[0];

      const senderAddress = convertEVMAddressToGenericAddress(sender.address);
      const message: MessageToSend = {
        params: getMessageParams(BigInt(adapterId)),
        sender: senderAddress,
        destinationChainId: BigInt(0),
        handler: convertEVMAddressToGenericAddress(getRandomAddress()),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        finalityLevel: Finality.IMMEDIATE,
        extraArgs: "0x",
      };

      // send message
      const sendMessage = bridgeRouter.connect(sender).sendMessage(message);
      await expect(sendMessage)
        .to.be.revertedWithCustomError(bridgeRouter, "AccessControlUnauthorizedAccount")
        .withArgs(sender.address, MESSAGE_SENDER_ROLE);
    });
  });

  describe("Receive Message", () => {
    it("Should successfuly receive message", async () => {
      const { unusedUsers, bridgeRouter, adapter, adapterId, adapterAddress, bridgeMessenger, bridgeMessengerAddress } =
        await loadFixture(deployBridgeMessengerFixture);
      const sender = unusedUsers[0];

      // balance before
      const bridgeRouterBalance = await ethers.provider.getBalance(bridgeRouter);

      const message: MessageReceived = {
        messageId: getRandomBytes(BYTES32_LENGTH),
        sourceChainId: BigInt(0),
        sourceAddress: convertEVMAddressToGenericAddress(adapterAddress),
        handler: convertEVMAddressToGenericAddress(bridgeMessengerAddress),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        returnAdapterId: BigInt(0),
        returnGasLimit: BigInt(0),
      };

      // receive message
      const balance = BigInt(30000);
      const receiveMessage = await adapter.receiveMessage(message, { value: balance });
      await expect(receiveMessage).to.emit(adapter, "ReceiveMessage").withArgs(message.messageId);
      await expect(receiveMessage).to.emit(bridgeMessenger, "ReceiveMessage").withArgs(message.messageId);
      await expect(receiveMessage).to.emit(bridgeRouter, "MessageSucceeded").withArgs(adapterId, message.messageId);
      expect(await bridgeRouter.seenMessages(adapterId, message.messageId)).to.be.true;
      expect(await bridgeRouter.balances(accountId)).to.be.equal(balance);
      expect(await ethers.provider.getBalance(bridgeRouter)).to.be.equal(bridgeRouterBalance + balance);
    });

    it("Should fail to receive message when adapter not added", async () => {
      const { unusedUsers, bridgeRouter } = await loadFixture(deployBridgeRouterFixture);
      const sender = unusedUsers[0];

      const message: MessageReceived = {
        messageId: getRandomBytes(BYTES32_LENGTH),
        sourceChainId: BigInt(0),
        sourceAddress: convertEVMAddressToGenericAddress(sender.address),
        handler: convertEVMAddressToGenericAddress(getRandomAddress()),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        returnAdapterId: BigInt(0),
        returnGasLimit: BigInt(0),
      };

      // receive message not from adapter
      const receiveMessage = bridgeRouter.connect(sender).receiveMessage(message);
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(bridgeRouter, "AdapterUnknown")
        .withArgs(sender.address);
    });

    it("Should fail to receive message when message already seen", async () => {
      const { unusedUsers, bridgeRouter, adapter, adapterAddress, bridgeMessengerAddress } =
        await loadFixture(deployBridgeMessengerFixture);
      const sender = unusedUsers[0];

      const message: MessageReceived = {
        messageId: getRandomBytes(BYTES32_LENGTH),
        sourceChainId: BigInt(0),
        sourceAddress: convertEVMAddressToGenericAddress(adapterAddress),
        handler: convertEVMAddressToGenericAddress(bridgeMessengerAddress),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        returnAdapterId: BigInt(0),
        returnGasLimit: BigInt(0),
      };

      // receive message twice
      await adapter.receiveMessage(message);
      const receiveMessage = adapter.receiveMessage(message);
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(bridgeRouter, "MessageAlreadySeen")
        .withArgs(message.messageId);
    });

    it("Should catch fail to receive message when handler reverts", async () => {
      const { bridgeRouter, adapter, adapterId, bridgeMessenger, message, balance, receiveMessage } =
        await loadFixture(deployFailedMessageFixture);

      // receive message
      const errorReason = bridgeMessenger.interface.encodeErrorResult("CannotReceiveMessage", [message.messageId]);
      const messageHash = getMessageReceivedHash(message);
      await expect(receiveMessage).to.emit(adapter, "ReceiveMessage").withArgs(message.messageId);
      await expect(receiveMessage).not.to.emit(bridgeMessenger, "ReceiveMessage");
      await expect(receiveMessage)
        .to.emit(bridgeRouter, "MessageFailed")
        .withArgs(adapterId, message.messageId, errorReason, Object.values(message), messageHash);
      expect(await bridgeRouter.seenMessages(adapterId, message.messageId)).to.be.true;
      expect(await bridgeRouter.failedMessages(adapterId, message.messageId)).to.be.equal(messageHash);
      expect(await ethers.provider.getBalance(bridgeRouter)).to.be.equal(balance);
    });
  });

  describe("Retry Message", () => {
    it("Should remove from failed if retry succeeds", async () => {
      const { bridgeRouter, adapterId, bridgeMessenger, message } = await loadFixture(deployFailedMessageFixture);

      // balance before
      const accountBalance = await bridgeRouter.balances(accountId);
      const bridgeRouterBalance = await ethers.provider.getBalance(bridgeRouter);

      // set handler to succeed
      await bridgeMessenger.setShouldFail(false);

      // retry message
      const balance = BigInt(30000);
      const retryMessage = await bridgeRouter.retryMessage(adapterId, message.messageId, message, { value: balance });

      await expect(retryMessage).to.emit(bridgeMessenger, "ReceiveMessage").withArgs(message.messageId);
      await expect(retryMessage).to.emit(bridgeRouter, "MessageRetrySucceeded").withArgs(adapterId, message.messageId);
      expect(await bridgeRouter.seenMessages(adapterId, message.messageId)).to.be.true;
      expect((await bridgeRouter.failedMessages(adapterId, message.messageId))[0]).to.not.equal(message.messageId);
      expect(await bridgeRouter.balances(accountId)).to.be.equal(accountBalance + balance);
      expect(await ethers.provider.getBalance(bridgeRouter)).to.be.equal(bridgeRouterBalance + balance);
    });

    it("Should remain failed if retry fails", async () => {
      const { bridgeRouter, adapterId, bridgeMessenger, message } = await loadFixture(deployFailedMessageFixture);

      // balance before
      const accountBalance = await bridgeRouter.balances(accountId);
      const bridgeRouterBalance = await ethers.provider.getBalance(bridgeRouter);

      // set handler to fail
      await bridgeMessenger.setShouldFail(true);

      // retry message
      const balance = BigInt(30000);
      const retryMessage = await bridgeRouter.retryMessage(adapterId, message.messageId, message, { value: balance });

      const errorReason = bridgeMessenger.interface.encodeErrorResult("CannotReceiveMessage", [message.messageId]);
      const messageHash = getMessageReceivedHash(message);
      await expect(retryMessage).not.to.emit(bridgeMessenger, "ReceiveMessage");
      await expect(retryMessage)
        .to.emit(bridgeRouter, "MessageRetryFailed")
        .withArgs(adapterId, message.messageId, errorReason);
      expect(await bridgeRouter.seenMessages(adapterId, message.messageId)).to.be.true;
      expect(await bridgeRouter.failedMessages(adapterId, message.messageId)).to.be.equal(messageHash);
      expect(await bridgeRouter.balances(accountId)).to.be.equal(accountBalance + balance);
      expect(await ethers.provider.getBalance(bridgeRouter)).to.be.equal(bridgeRouterBalance + balance);
    });

    it("Should fail to retry when original message has not been seen", async () => {
      const { bridgeRouter, adapterId, message } = await loadFixture(deployFailedMessageFixture);

      // retry message
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const retryMessage = bridgeRouter.retryMessage(adapterId, messageId, message);
      await expect(retryMessage)
        .to.be.revertedWithCustomError(bridgeRouter, "FailedMessageUnknown")
        .withArgs(adapterId, messageId);
    });

    it("Should fail to retry when original message succeeded", async () => {
      const { unusedUsers, bridgeRouter, adapter, adapterId, adapterAddress, bridgeMessengerAddress } =
        await loadFixture(deployBridgeMessengerFixture);
      const sender = unusedUsers[0];

      // receive message
      const message: MessageReceived = {
        messageId: getRandomBytes(BYTES32_LENGTH),
        sourceChainId: BigInt(0),
        sourceAddress: convertEVMAddressToGenericAddress(adapterAddress),
        handler: convertEVMAddressToGenericAddress(bridgeMessengerAddress),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        returnAdapterId: BigInt(0),
        returnGasLimit: BigInt(0),
      };
      const receiveMessage = await adapter.receiveMessage(message);
      await expect(receiveMessage).to.emit(bridgeRouter, "MessageSucceeded").withArgs(adapterId, message.messageId);
      expect(await bridgeRouter.seenMessages(adapterId, message.messageId)).to.be.true;

      // retry message
      const retryMessage = bridgeRouter.retryMessage(adapterId, message.messageId, message);
      await expect(retryMessage)
        .to.be.revertedWithCustomError(bridgeRouter, "FailedMessageUnknown")
        .withArgs(adapterId, message.messageId);
    });

    it("Should fail to retry when original message failed but then succeeded", async () => {
      const { bridgeRouter, adapterId, bridgeMessenger, message } = await loadFixture(deployFailedMessageFixture);

      // set handler to succeed
      await bridgeMessenger.setShouldFail(false);

      // retry message twice
      await bridgeRouter.retryMessage(adapterId, message.messageId, message);
      const retryMessage = bridgeRouter.retryMessage(adapterId, message.messageId, message);
      await expect(retryMessage)
        .to.be.revertedWithCustomError(bridgeRouter, "FailedMessageUnknown")
        .withArgs(adapterId, message.messageId);
    });
  });

  describe("Reverse Message", () => {
    it("Should remove from failed if reverse succeeds", async () => {
      const { bridgeRouter, adapterId, bridgeMessenger, message } = await loadFixture(deployFailedMessageFixture);

      // balance before
      const accountBalance = await bridgeRouter.balances(accountId);
      const bridgeRouterBalance = await ethers.provider.getBalance(bridgeRouter);

      // set handler to succeed
      await bridgeMessenger.setShouldFail(false);

      // reverse message
      const extraArgs = getRandomBytes(BYTES32_LENGTH);
      const balance = BigInt(30000);
      const reverseMessage = await bridgeRouter.reverseMessage(adapterId, message.messageId, message, extraArgs, {
        value: balance,
      });

      await expect(reverseMessage).to.emit(bridgeMessenger, "ReverseMessage").withArgs(message.messageId, extraArgs);
      await expect(reverseMessage)
        .to.emit(bridgeRouter, "MessageReverseSucceeded")
        .withArgs(adapterId, message.messageId);
      expect(await bridgeRouter.seenMessages(adapterId, message.messageId)).to.be.true;
      expect((await bridgeRouter.failedMessages(adapterId, message.messageId))[0]).to.not.equal(message.messageId);
      expect(await bridgeRouter.balances(accountId)).to.be.equal(accountBalance + balance);
      expect(await ethers.provider.getBalance(bridgeRouter)).to.be.equal(bridgeRouterBalance + balance);
    });

    it("Should remain failed if reverse fails", async () => {
      const { bridgeRouter, adapterId, bridgeMessenger, message } = await loadFixture(deployFailedMessageFixture);

      // balance before
      const accountBalance = await bridgeRouter.balances(accountId);
      const bridgeRouterBalance = await ethers.provider.getBalance(bridgeRouter);

      // set handler to fail
      await bridgeMessenger.setShouldFail(true);

      // reverse message
      const extraArgs = getRandomBytes(BYTES32_LENGTH);
      const balance = BigInt(30000);
      const reverseMessage = await bridgeRouter.reverseMessage(adapterId, message.messageId, message, extraArgs, {
        value: balance,
      });

      const errorReason = bridgeMessenger.interface.encodeErrorResult("CannotReverseMessage", [message.messageId]);
      const messageHash = getMessageReceivedHash(message);
      await expect(reverseMessage).not.to.emit(bridgeMessenger, "ReceiveMessage");
      await expect(reverseMessage)
        .to.emit(bridgeRouter, "MessageReverseFailed")
        .withArgs(adapterId, message.messageId, errorReason);
      expect(await bridgeRouter.seenMessages(adapterId, message.messageId)).to.be.true;
      expect(await bridgeRouter.failedMessages(adapterId, message.messageId)).to.be.equal(messageHash);
      expect(await bridgeRouter.balances(accountId)).to.be.equal(accountBalance + balance);
      expect(await ethers.provider.getBalance(bridgeRouter)).to.be.equal(bridgeRouterBalance + balance);
    });

    it("Should fail to reverse when original message has not been seen", async () => {
      const { bridgeRouter, adapterId, message } = await loadFixture(deployFailedMessageFixture);

      // reverse message
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const extraArgs = getRandomBytes(BYTES32_LENGTH);
      const reverseMessage = bridgeRouter.reverseMessage(adapterId, messageId, message, extraArgs);
      await expect(reverseMessage)
        .to.be.revertedWithCustomError(bridgeRouter, "FailedMessageUnknown")
        .withArgs(adapterId, messageId);
    });

    it("Should fail to reverse when original message succeeded", async () => {
      const { unusedUsers, bridgeRouter, adapter, adapterId, adapterAddress, bridgeMessenger, bridgeMessengerAddress } =
        await loadFixture(deployBridgeMessengerFixture);
      const sender = unusedUsers[0];

      // receive message
      const message: MessageReceived = {
        messageId: getRandomBytes(BYTES32_LENGTH),
        sourceChainId: BigInt(0),
        sourceAddress: convertEVMAddressToGenericAddress(adapterAddress),
        handler: convertEVMAddressToGenericAddress(bridgeMessengerAddress),
        payload: buildMessagePayload(0, accountId, sender.address, "0x"),
        returnAdapterId: BigInt(0),
        returnGasLimit: BigInt(0),
      };
      const receiveMessage = await adapter.receiveMessage(message);
      await expect(receiveMessage).to.emit(bridgeRouter, "MessageSucceeded").withArgs(adapterId, message.messageId);
      expect(await bridgeRouter.seenMessages(adapterId, message.messageId)).to.be.true;

      // reverse message
      const extraArgs = getRandomBytes(BYTES32_LENGTH);
      const reverseMessage = bridgeRouter.reverseMessage(adapterId, message.messageId, message, extraArgs);
      await expect(reverseMessage)
        .to.be.revertedWithCustomError(bridgeRouter, "FailedMessageUnknown")
        .withArgs(adapterId, message.messageId);
    });

    it("Should fail to reverse when original message failed but then succeeded", async () => {
      const { bridgeRouter, adapterId, bridgeMessenger, message } = await loadFixture(deployFailedMessageFixture);

      // set handler to succeed
      await bridgeMessenger.setShouldFail(false);

      // reverse message twice
      const extraArgs = getRandomBytes(BYTES32_LENGTH);
      await bridgeRouter.reverseMessage(adapterId, message.messageId, message, extraArgs);
      const reverseMessage = bridgeRouter.reverseMessage(adapterId, message.messageId, message, extraArgs);
      await expect(reverseMessage)
        .to.be.revertedWithCustomError(bridgeRouter, "FailedMessageUnknown")
        .withArgs(adapterId, message.messageId);
    });
  });

  describe("Increase balance", () => {
    it("Should successfuly increase balance by msg.value", async () => {
      const { bridgeRouter } = await loadFixture(deployBridgeRouterFixture);

      // balance before
      const bridgeRouterBalance = await ethers.provider.getBalance(bridgeRouter);

      // increase balance
      const userId = getRandomBytes(BYTES32_LENGTH);
      const startingBalance = BigInt(0.0001e18);
      await bridgeRouter.increaseBalance(userId, { value: startingBalance });
      expect(await bridgeRouter.balances(userId)).to.equal(startingBalance);
      expect(await ethers.provider.getBalance(bridgeRouter)).to.be.equal(bridgeRouterBalance + startingBalance);

      // increase balance
      const increaseBalance = BigInt(0.000005e18);
      const totalBalance = startingBalance + increaseBalance;
      await bridgeRouter.increaseBalance(userId, { value: increaseBalance });
      expect(await bridgeRouter.balances(userId)).to.equal(totalBalance);
      expect(await ethers.provider.getBalance(bridgeRouter)).to.be.equal(bridgeRouterBalance + totalBalance);
    });
  });
});
