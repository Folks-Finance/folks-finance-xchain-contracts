import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  BridgeRouterSender__factory,
  MockCircleMessageTransmitter__factory,
  MockCircleTokenMessenger__factory,
  MockWormhole__factory,
  MockWormholeRelayer__factory,
  SimpleERC20Token__factory,
  WormholeCCTPAdapter__factory,
} from "../../typechain-types";
import {
  BYTES32_LENGTH,
  BYTES4_LENGTH,
  UINT32_LENGTH,
  UINT64_LENGTH,
  UINT8_LENGTH,
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
  Finality,
  MessageParams,
  MessageToSend,
  buildMessagePayload,
  encodePayloadWithMetadata,
  extraArgsToBytes,
} from "../utils/messages/messages";
import { SECONDS_IN_DAY, getRandomInt } from "../utils/time";
import { WormholeFinality } from "../utils/wormhole";
import { encodePayloadWithCCTPMetadata } from "../utils/messages/cctpMessages";

describe("WormholeCCTPAdapter (unit tests)", () => {
  const DEFAULT_ADMIN_ROLE = getEmptyBytes(BYTES32_LENGTH);
  const MANAGER_ROLE = ethers.keccak256(convertStringToBytes("MANAGER"));

  const getMessageParams = (): MessageParams => ({
    adapterId: BigInt(0),
    receiverValue: BigInt(0),
    gasLimit: BigInt(30000),
    returnAdapterId: BigInt(0),
    returnGasLimit: BigInt(0),
  });

  const getMessage = (
    destChainId: number,
    tokenAddress: string,
    recipientAddress: string,
    amount: bigint
  ): MessageToSend => ({
    params: getMessageParams(),
    sender: convertEVMAddressToGenericAddress(getRandomAddress()),
    destinationChainId: BigInt(destChainId),
    handler: convertEVMAddressToGenericAddress(getRandomAddress()),
    payload: buildMessagePayload(0, getAccountIdBytes("ACCOUNT_ID"), getRandomAddress(), "0x"),
    finalityLevel: Finality.FINALISED,
    extraArgs: extraArgsToBytes(tokenAddress, recipientAddress, amount),
  });

  async function deployWormholeCCTPAdapterFixture() {
    const [user, admin, ...unusedUsers] = await ethers.getSigners();

    // deploy token and fund user
    const circleToken = await new SimpleERC20Token__factory(user).deploy("USD Coin", "USDC");
    await circleToken.mint(user, BigInt(1000e18));
    const circleTokenAddress = await circleToken.getAddress();

    // deploy adapter
    const wormhole = await new MockWormhole__factory(admin).deploy();
    const relayer = await new MockWormholeRelayer__factory(admin).deploy();
    const bridgeRouter = await new BridgeRouterSender__factory(admin).deploy();
    const circleMessageTransmitter = await new MockCircleMessageTransmitter__factory(admin).deploy();
    const circleTokenMessenger = await new MockCircleTokenMessenger__factory(admin).deploy();
    const refundAddress = getRandomAddress();
    const cctpSourceDomainId = 328057832;
    const adapter = await new WormholeCCTPAdapter__factory(user).deploy(
      admin,
      wormhole,
      relayer,
      bridgeRouter,
      circleMessageTransmitter,
      circleTokenMessenger,
      refundAddress,
      circleToken,
      cctpSourceDomainId
    );
    await bridgeRouter.setAdapter(adapter);

    return {
      user,
      admin,
      unusedUsers,
      adapter,
      wormhole,
      relayer,
      bridgeRouter,
      circleMessageTransmitter,
      circleTokenMessenger,
      refundAddress,
      cctpSourceDomainId,
      circleToken,
      circleTokenAddress,
    };
  }

  async function addChainFixture() {
    const {
      user,
      admin,
      unusedUsers,
      adapter,
      wormhole,
      relayer,
      bridgeRouter,
      circleMessageTransmitter,
      circleTokenMessenger,
      refundAddress,
      cctpSourceDomainId,
      circleToken,
      circleTokenAddress,
    } = await loadFixture(deployWormholeCCTPAdapterFixture);

    // add chain
    const folksChainId = 0;
    const wormholeChainId = 5;
    const cctpDomainId = 91140935;
    const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());
    await adapter.connect(admin).addChain(folksChainId, wormholeChainId, cctpDomainId, corrAdapterAddress);

    return {
      user,
      admin,
      unusedUsers,
      adapter,
      wormhole,
      relayer,
      bridgeRouter,
      circleMessageTransmitter,
      circleTokenMessenger,
      refundAddress,
      cctpSourceDomainId,
      circleToken,
      circleTokenAddress,
      folksChainId,
      wormholeChainId,
      cctpDomainId,
      corrAdapterAddress,
    };
  }

  describe("Deployment", () => {
    it("Should set admin, relayer and bridge router correctly", async () => {
      const { admin, adapter, relayer, bridgeRouter, refundAddress } = await loadFixture(
        deployWormholeCCTPAdapterFixture
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
      const { admin, adapter } = await loadFixture(deployWormholeCCTPAdapterFixture);

      // set refund address
      const refundAddress = getRandomAddress();
      await adapter.connect(admin).setRefundAddress(refundAddress);
      expect(await adapter.refundAddress()).to.equal(refundAddress);
    });

    it("Should fail to set refund address when sender is not manager", async () => {
      const { user, adapter } = await loadFixture(deployWormholeCCTPAdapterFixture);

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
      const { adapter, folksChainId, wormholeChainId, cctpDomainId, corrAdapterAddress } =
        await loadFixture(addChainFixture);

      // verfy added
      expect(await adapter.isChainAvailable(folksChainId)).to.be.true;
      expect(await adapter.getChainAdapter(folksChainId)).to.be.eql([
        BigInt(wormholeChainId),
        corrAdapterAddress,
        BigInt(cctpDomainId),
      ]);
    });

    it("Should fail to add chain when sender is not manager", async () => {
      const { user, adapter } = await loadFixture(deployWormholeCCTPAdapterFixture);

      const folksChainId = 0;
      const wormholeChainId = 5;
      const cctpDomainId = 91140935;
      const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());

      // add chain
      const addChain = adapter.connect(user).addChain(folksChainId, wormholeChainId, cctpDomainId, corrAdapterAddress);
      await expect(addChain)
        .to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, MANAGER_ROLE);
    });

    it("Should fail to add chain when already added", async () => {
      const { admin, adapter, folksChainId } = await loadFixture(addChainFixture);

      const wormholeChainId = 3;
      const cctpDomainId = 91140935;
      const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());

      // verify added
      expect(await adapter.isChainAvailable(folksChainId)).to.be.true;

      // add chain
      const addChain = adapter.connect(admin).addChain(folksChainId, wormholeChainId, cctpDomainId, corrAdapterAddress);
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
      const { admin, adapter } = await loadFixture(deployWormholeCCTPAdapterFixture);

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
      const { admin, adapter } = await loadFixture(deployWormholeCCTPAdapterFixture);

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
      const { adapter, wormhole, folksChainId, circleTokenAddress } = await loadFixture(addChainFixture);

      // set publish fee
      const publishFee = BigInt(getRandomInt(100_000));
      await wormhole.setMessageFee(publishFee);

      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      const deliveryFee = message.params.receiverValue + message.params.gasLimit;

      // get send fee
      const fee = await adapter.getSendFee(message);
      expect(fee).to.be.equal(deliveryFee + publishFee);
    });

    it("Should fail to get send fee when chain not added", async () => {
      const { adapter, circleTokenAddress } = await loadFixture(addChainFixture);

      // verify not added
      const folksChainId = 23;
      expect(await adapter.isChainAvailable(folksChainId)).to.be.false;

      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);

      // get send fee
      const getSendFee = adapter.getSendFee(message);
      await expect(getSendFee).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });
  });

  describe("Send Messsage", () => {
    it("Should successfuly send message", async () => {
      const {
        user,
        adapter,
        bridgeRouter,
        circleTokenMessenger,
        refundAddress,
        cctpSourceDomainId,
        relayer,
        folksChainId,
        wormholeChainId,
        cctpDomainId,
        corrAdapterAddress,
        circleToken,
        circleTokenAddress,
      } = await loadFixture(addChainFixture);

      // balances before
      const adapterBalance = await ethers.provider.getBalance(adapter);
      const relayerNativeBalance = await ethers.provider.getBalance(relayer);
      const userBalance = await circleToken.balanceOf(user);
      const circleTokenMessengerBalance = await circleToken.balanceOf(circleTokenMessenger);

      // manually send token (would normally be done in spoke/hub)
      const amount = BigInt(0.1e18);
      await circleToken.connect(user).transfer(adapter, amount);

      // set nonce
      const nonce = BigInt(8237598235);
      await circleTokenMessenger.setNonce(nonce);

      // get fee
      const recipientAddress = getRandomAddress();
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
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
        .to.emit(circleTokenMessenger, "DepositForBurnWithCaller")
        .withArgs(
          amount,
          cctpDomainId,
          convertEVMAddressToGenericAddress(recipientAddress),
          circleTokenAddress,
          corrAdapterAddress
        );
      await expect(sendMessage).to.emit(adapter, "SendMessage");
      await expect(sendMessage)
        .to.emit(relayer, "WormholeSendMessageKey")
        .withArgs(
          wormholeChainId,
          convertGenericAddressToEVMAddress(corrAdapterAddress),
          encodePayloadWithCCTPMetadata(cctpSourceDomainId, amount, nonce, recipientAddress, message),
          message.params.receiverValue,
          0,
          message.params.gasLimit,
          wormholeChainId,
          refundAddress,
          ethers.ZeroAddress,
          [
            [
              convertNumberToBytes(2, UINT8_LENGTH),
              ethers.concat([
                convertNumberToBytes(cctpSourceDomainId, UINT32_LENGTH),
                convertNumberToBytes(nonce, UINT64_LENGTH),
              ]),
            ],
          ],
          WormholeFinality.FINALIZED
        );

      // balances after
      expect(await ethers.provider.getBalance(adapter)).to.equal(adapterBalance);
      expect(await ethers.provider.getBalance(relayer)).to.equal(relayerNativeBalance + fee);
      expect(await circleToken.balanceOf(user)).to.equal(userBalance - amount);
      expect(await circleToken.balanceOf(adapter)).to.equal(0);
      expect(await circleToken.balanceOf(circleTokenMessenger)).to.equal(circleTokenMessengerBalance + amount);
      expect(await circleToken.allowance(adapter, circleTokenMessenger)).to.equal(0);
    });

    it("Should fail to send message when chain not added", async () => {
      const { adapter, bridgeRouter, circleTokenAddress } = await loadFixture(deployWormholeCCTPAdapterFixture);

      // verify not added
      const folksChainId = 23;
      expect(await adapter.isChainAvailable(folksChainId)).to.be.false;

      // get fee
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      const fee = 10000;

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });

    it("Should fail to send message when sender is not bridge router", async () => {
      const { user, adapter, folksChainId, circleTokenAddress } = await loadFixture(addChainFixture);

      // get fee
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = adapter.connect(user).sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "InvalidBridgeRouter").withArgs(user.address);
    });

    it("Should fail to send message when immediate finality level", async () => {
      const { adapter, bridgeRouter, folksChainId, circleTokenAddress } = await loadFixture(addChainFixture);

      // get fee
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      message.finalityLevel = Finality.IMMEDIATE;
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidFinalityLevel")
        .withArgs(Finality.IMMEDIATE);
    });

    it("Should fail to send message when extra args is empty", async () => {
      const { adapter, bridgeRouter, folksChainId, circleTokenAddress } = await loadFixture(addChainFixture);

      // get fee
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      message.extraArgs = "0x";
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "EmptyExtraArgs");
    });

    it("Should fail to send message when extra args is ill defined", async () => {
      const { adapter, bridgeRouter, folksChainId, circleTokenAddress } = await loadFixture(addChainFixture);

      // get fee
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      const fee = await adapter.getSendFee(message);

      // replace extra args tag
      message.extraArgs = ethers.concat([
        getRandomBytes(BYTES4_LENGTH),
        "0x" + message.extraArgs.slice(2 * BYTES4_LENGTH + 2),
      ]);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "InvalidExtraArgsTag");
    });

    it("Should fail to send message when token invalid", async () => {
      const { adapter, bridgeRouter, folksChainId } = await loadFixture(addChainFixture);

      // verify unsupported
      const tokenAddress = getRandomAddress();
      expect(await adapter.circleToken()).to.not.equal(tokenAddress);

      // get fee
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidTokenAddress")
        .withArgs(convertEVMAddressToGenericAddress(tokenAddress));
    });
  });

  describe("Receive Message", () => {
    it("Should successfuly receive message", async () => {
      const {
        user,
        adapter,
        relayer,
        bridgeRouter,
        circleMessageTransmitter,
        folksChainId,
        wormholeChainId,
        cctpDomainId,
        corrAdapterAddress,
        circleToken,
        circleTokenAddress,
      } = await loadFixture(addChainFixture);

      // balances before
      const recipientAddress = getRandomAddress();
      const adapterBalance = await ethers.provider.getBalance(adapter);
      const bridgeRouterBalance = await ethers.provider.getBalance(bridgeRouter);
      const recipientBalance = await circleToken.balanceOf(recipientAddress);

      // manually send token (would normally be done by relayer)
      const amount = BigInt(0.1e18);
      await circleToken.connect(user).transfer(circleMessageTransmitter, amount);

      // prepare circle message transmitter
      await circleMessageTransmitter.setToken(circleTokenAddress);
      await circleMessageTransmitter.setRecipient(recipientAddress);
      await circleMessageTransmitter.setAmount(amount);

      // construct message
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const nonce = BigInt(8237598235);
      const additionalMessage = ethers.concat([
        getRandomBytes(12),
        convertNumberToBytes(nonce, UINT64_LENGTH),
        getRandomBytes(100),
      ]);
      const additionalMessageSignature = getRandomBytes(BYTES32_LENGTH);
      const receiverValue = BigInt(30000);
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithCCTPMetadata(cctpDomainId, amount, nonce, recipientAddress, message),
        [abiCoder.encode(["bytes", "bytes"], [additionalMessage, additionalMessageSignature])],
        corrAdapterAddress,
        wormholeChainId,
        messageId,
        { value: receiverValue }
      );
      await expect(receiveMessage)
        .to.emit(circleMessageTransmitter, "ReceiveMessage")
        .withArgs(additionalMessage, additionalMessageSignature);
      await expect(receiveMessage)
        .to.emit(adapter, "ReceiveMessage(bytes32,bytes32)")
        .withArgs(messageId, corrAdapterAddress);

      // balances after
      expect(await ethers.provider.getBalance(adapter)).to.equal(adapterBalance);
      expect(await ethers.provider.getBalance(bridgeRouter)).to.equal(bridgeRouterBalance + receiverValue);
      expect(await circleToken.balanceOf(recipientAddress)).to.equal(recipientBalance + amount);
      expect(await circleToken.balanceOf(circleMessageTransmitter)).to.equal(0);
    });

    it("Should fail to receive message when chain when not added", async () => {
      const { adapter, relayer, folksChainId, corrAdapterAddress, circleTokenAddress } =
        await loadFixture(addChainFixture);

      // verify chain unknown
      const wormholeChainId = 4;
      expect((await adapter.getChainAdapter(folksChainId))[0]).to.not.equal(wormholeChainId);

      // construct message
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
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
      const { adapter, relayer, folksChainId, wormholeChainId, cctpDomainId, circleTokenAddress } =
        await loadFixture(addChainFixture);

      // verify sender unknown
      const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());
      expect((await adapter.getChainAdapter(folksChainId))[1]).to.not.equal(corrAdapterAddress);

      // construct message
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const nonce = BigInt(8237598235);
      const additionalMessage = ethers.concat([
        getRandomBytes(12),
        convertNumberToBytes(nonce, UINT64_LENGTH),
        getRandomBytes(100),
      ]);
      const additionalMessageSignature = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithCCTPMetadata(cctpDomainId, amount, nonce, recipientAddress, message),
        [abiCoder.encode(["bytes", "bytes"], [additionalMessage, additionalMessageSignature])],
        corrAdapterAddress,
        wormholeChainId,
        messageId
      );
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidMessageSender")
        .withArgs(corrAdapterAddress);
    });

    it("Should fail to receive message when sender is not wormhole relayer", async () => {
      const { admin, adapter, folksChainId, wormholeChainId, corrAdapterAddress, cctpDomainId, circleTokenAddress } =
        await loadFixture(addChainFixture);

      // verify relayer unknown
      const relayer = await new MockWormholeRelayer__factory(admin).deploy();
      const relayerAddress = await relayer.getAddress();
      expect(await adapter.wormholeRelayer()).to.not.equal(relayerAddress);

      // construct message
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const nonce = BigInt(8237598235);
      const additionalMessage = ethers.concat([
        getRandomBytes(12),
        convertNumberToBytes(nonce, UINT64_LENGTH),
        getRandomBytes(100),
      ]);
      const additionalMessageSignature = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithCCTPMetadata(cctpDomainId, amount, nonce, recipientAddress, message),
        [abiCoder.encode(["bytes", "bytes"], [additionalMessage, additionalMessageSignature])],
        corrAdapterAddress,
        wormholeChainId,
        messageId
      );
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidWormholeRelayer")
        .withArgs(relayerAddress);
    });

    it("Should fail to receive message when no additional messages", async () => {
      const { adapter, relayer, folksChainId, wormholeChainId, cctpDomainId, corrAdapterAddress, circleTokenAddress } =
        await loadFixture(addChainFixture);

      // construct message
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const nonce = BigInt(8237598235);

      // receive message
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithCCTPMetadata(cctpDomainId, amount, nonce, recipientAddress, message),
        [],
        corrAdapterAddress,
        wormholeChainId,
        messageId
      );
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "InvalidAdditionalMessagesLength");
    });

    it("Should fail to receive message when more than one additional message", async () => {
      const { adapter, relayer, folksChainId, wormholeChainId, cctpDomainId, corrAdapterAddress, circleTokenAddress } =
        await loadFixture(addChainFixture);

      // construct message
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const nonce = BigInt(8237598235);
      const additionalMessage = ethers.concat([
        getRandomBytes(12),
        convertNumberToBytes(nonce, UINT64_LENGTH),
        getRandomBytes(100),
      ]);
      const additionalMessageSignature = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithCCTPMetadata(cctpDomainId, amount, nonce, recipientAddress, message),
        [
          abiCoder.encode(["bytes", "bytes"], [additionalMessage, additionalMessageSignature]),
          abiCoder.encode(["bytes", "bytes"], [additionalMessage, additionalMessageSignature]),
        ],
        corrAdapterAddress,
        wormholeChainId,
        messageId
      );
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "InvalidAdditionalMessagesLength");
    });

    it("Should fail to receive message when cctp domains differ", async () => {
      const { adapter, relayer, folksChainId, wormholeChainId, cctpDomainId, corrAdapterAddress, circleTokenAddress } =
        await loadFixture(addChainFixture);

      // verify cctp domain does not match
      const metadataCctpDomainId = 210924362;
      expect(cctpDomainId).to.not.equal(metadataCctpDomainId);

      // construct message
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const nonce = BigInt(8237598235);
      const additionalMessage = ethers.concat([
        getRandomBytes(12),
        convertNumberToBytes(nonce, UINT64_LENGTH),
        getRandomBytes(100),
      ]);
      const additionalMessageSignature = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithCCTPMetadata(metadataCctpDomainId, amount, nonce, recipientAddress, message),
        [abiCoder.encode(["bytes", "bytes"], [additionalMessage, additionalMessageSignature])],
        corrAdapterAddress,
        wormholeChainId,
        messageId
      );
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidCCTPSourceDomain")
        .withArgs(metadataCctpDomainId);
    });

    it("Should fail to receive message when nonces differ", async () => {
      const { adapter, relayer, folksChainId, wormholeChainId, cctpDomainId, corrAdapterAddress, circleTokenAddress } =
        await loadFixture(addChainFixture);

      const cctpNonce = BigInt(8237598235);
      const metadataNonce = BigInt(1983584232);

      // construct message
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const additionalMessage = ethers.concat([
        getRandomBytes(12),
        convertNumberToBytes(cctpNonce, UINT64_LENGTH),
        getRandomBytes(100),
      ]);
      const additionalMessageSignature = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithCCTPMetadata(cctpDomainId, amount, metadataNonce, recipientAddress, message),
        [abiCoder.encode(["bytes", "bytes"], [additionalMessage, additionalMessageSignature])],
        corrAdapterAddress,
        wormholeChainId,
        messageId
      );
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "InvalidCCTPNonce").withArgs(metadataNonce);
    });

    it("Should fail to receive message when circle message fails to be received", async () => {
      const {
        user,
        adapter,
        relayer,
        circleMessageTransmitter,
        folksChainId,
        wormholeChainId,
        cctpDomainId,
        corrAdapterAddress,
        circleToken,
        circleTokenAddress,
      } = await loadFixture(addChainFixture);

      // manually send token (would normally be done by relayer)
      const amount = BigInt(0.1e18);
      await circleToken.connect(user).transfer(circleMessageTransmitter, amount);

      // prepare circle message transmitter
      const recipientAddress = getRandomAddress();
      await circleMessageTransmitter.setSuccess(false);
      await circleMessageTransmitter.setToken(circleTokenAddress);
      await circleMessageTransmitter.setRecipient(recipientAddress);
      await circleMessageTransmitter.setAmount(amount);

      // construct message
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const nonce = BigInt(8237598235);
      const additionalMessage = ethers.concat([
        getRandomBytes(12),
        convertNumberToBytes(nonce, UINT64_LENGTH),
        getRandomBytes(100),
      ]);
      const additionalMessageSignature = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithCCTPMetadata(cctpDomainId, amount, nonce, recipientAddress, message),
        [abiCoder.encode(["bytes", "bytes"], [additionalMessage, additionalMessageSignature])],
        corrAdapterAddress,
        wormholeChainId,
        messageId
      );
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "CircleTransmitterMintFail")
        .withArgs(additionalMessage);
    });

    it("Should fail to receive message when amounts differ", async () => {
      const {
        user,
        adapter,
        relayer,
        circleMessageTransmitter,
        folksChainId,
        wormholeChainId,
        cctpDomainId,
        corrAdapterAddress,
        circleToken,
        circleTokenAddress,
      } = await loadFixture(addChainFixture);

      // manually send token (would normally be done by relayer)
      const amount = BigInt(0.05e18);
      await circleToken.connect(user).transfer(circleMessageTransmitter, amount);

      // prepare circle message transmitter
      const recipientAddress = getRandomAddress();
      await circleMessageTransmitter.setToken(circleTokenAddress);
      await circleMessageTransmitter.setRecipient(recipientAddress);
      await circleMessageTransmitter.setAmount(amount);

      // construct message
      const metadataAmount = BigInt(0.1e18);
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, metadataAmount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const nonce = BigInt(8237598235);
      const additionalMessage = ethers.concat([
        getRandomBytes(12),
        convertNumberToBytes(nonce, UINT64_LENGTH),
        getRandomBytes(100),
      ]);
      const additionalMessageSignature = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithCCTPMetadata(cctpDomainId, metadataAmount, nonce, recipientAddress, message),
        [abiCoder.encode(["bytes", "bytes"], [additionalMessage, additionalMessageSignature])],
        corrAdapterAddress,
        wormholeChainId,
        messageId
      );
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidReceivedAmount")
        .withArgs(metadataAmount, amount);
    });

    it("Should fail to receive message when token recipient is different", async () => {
      const {
        user,
        adapter,
        relayer,
        circleMessageTransmitter,
        folksChainId,
        wormholeChainId,
        cctpDomainId,
        corrAdapterAddress,
        circleToken,
        circleTokenAddress,
      } = await loadFixture(addChainFixture);

      // manually send token (would normally be done by relayer)
      const amount = BigInt(0.1e18);
      await circleToken.connect(user).transfer(circleMessageTransmitter, amount);

      // prepare circle message transmitter
      const actualRecipientAddress = getRandomAddress();
      await circleMessageTransmitter.setToken(circleTokenAddress);
      await circleMessageTransmitter.setRecipient(actualRecipientAddress);
      await circleMessageTransmitter.setAmount(amount);

      // construct message
      const expectedRecipientAddress = getRandomAddress();
      const message = getMessage(folksChainId, circleTokenAddress, expectedRecipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const nonce = BigInt(8237598235);
      const additionalMessage = ethers.concat([
        getRandomBytes(12),
        convertNumberToBytes(nonce, UINT64_LENGTH),
        getRandomBytes(100),
      ]);
      const additionalMessageSignature = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithCCTPMetadata(cctpDomainId, amount, nonce, expectedRecipientAddress, message),
        [abiCoder.encode(["bytes", "bytes"], [additionalMessage, additionalMessageSignature])],
        corrAdapterAddress,
        wormholeChainId,
        messageId
      );
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "InvalidReceivedAmount").withArgs(amount, 0);
    });

    it("Should fail to receive message when token is different", async () => {
      const {
        user,
        adapter,
        relayer,
        circleMessageTransmitter,
        folksChainId,
        wormholeChainId,
        cctpDomainId,
        corrAdapterAddress,
        circleToken,
        circleTokenAddress,
      } = await loadFixture(addChainFixture);

      // create fake token
      const fakeToken = await new SimpleERC20Token__factory(user).deploy("Fake USD Coin", "F-USDC");
      await fakeToken.mint(user, BigInt(1000e18));

      // manually send fake token (would normally be done by relayer)
      const amount = BigInt(0.1e18);
      await fakeToken.connect(user).transfer(circleMessageTransmitter, amount);

      // prepare circle message transmitter
      const recipientAddress = getRandomAddress();
      await circleMessageTransmitter.setToken(fakeToken);
      await circleMessageTransmitter.setRecipient(recipientAddress);
      await circleMessageTransmitter.setAmount(amount);

      // construct message
      const message = getMessage(folksChainId, circleTokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const nonce = BigInt(8237598235);
      const additionalMessage = ethers.concat([
        getRandomBytes(12),
        convertNumberToBytes(nonce, UINT64_LENGTH),
        getRandomBytes(100),
      ]);
      const additionalMessageSignature = getRandomBytes(BYTES32_LENGTH);

      // receive message
      const receiveMessage = relayer.deliverToAdapter(
        adapter,
        encodePayloadWithCCTPMetadata(cctpDomainId, amount, nonce, recipientAddress, message),
        [abiCoder.encode(["bytes", "bytes"], [additionalMessage, additionalMessageSignature])],
        corrAdapterAddress,
        wormholeChainId,
        messageId
      );
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "InvalidReceivedAmount").withArgs(amount, 0);
    });
  });
});
