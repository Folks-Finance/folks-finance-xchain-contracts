import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  BridgeRouterSender__factory,
  CCIPTokenAdapter__factory,
  MockCCIPRouterClient__factory,
  SimpleERC20Token__factory,
} from "../../typechain-types";
import {
  BYTES32_LENGTH,
  BYTES4_LENGTH,
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
import { encodePayloadWithCCIPTokenMetadata } from "../utils/messages/ccipTokenMessages";
import {
  CCIPMessageReceived,
  Finality,
  MessageParams,
  MessageToSend,
  buildMessagePayload,
  extraArgsToBytes,
} from "../utils/messages/messages";
import { SECONDS_IN_DAY } from "../utils/time";

describe("CCIPTokenAdapter (unit tests)", () => {
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

  async function deployCCIPTokenAdapterFixture() {
    const [user, admin, ...unusedUsers] = await ethers.getSigners();

    // deploy adapter
    const relayer = await new MockCCIPRouterClient__factory(admin).deploy();
    const bridgeRouter = await new BridgeRouterSender__factory(admin).deploy();
    const adapter = await new CCIPTokenAdapter__factory(user).deploy(admin, relayer, bridgeRouter);
    await bridgeRouter.setAdapter(adapter);

    return { user, admin, unusedUsers, adapter, relayer, bridgeRouter };
  }

  async function addChainFixture() {
    const { user, admin, unusedUsers, adapter, relayer, bridgeRouter } =
      await loadFixture(deployCCIPTokenAdapterFixture);

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

  async function addSupportedTokenFixture() {
    const { user, admin, unusedUsers, adapter, relayer, bridgeRouter, folksChainId, ccipChainId, corrAdapterAddress } =
      await loadFixture(addChainFixture);

    // deploy token and fund user
    const token = await new SimpleERC20Token__factory(user).deploy("USD Coin", "USDC");
    await token.mint(user, BigInt(1000e18));

    // add token
    const tokenAddress = await token.getAddress();
    await adapter.connect(admin).addSupportedToken(tokenAddress);

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
      token,
      tokenAddress,
    };
  }

  describe("Deployment", () => {
    it("Should set admin, relayer and bridge router correctly", async () => {
      const { admin, adapter, relayer, bridgeRouter } = await loadFixture(deployCCIPTokenAdapterFixture);

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

  describe("Add Supported Token", () => {
    it("Should successfully add token", async () => {
      const { adapter, token } = await loadFixture(addSupportedTokenFixture);

      // verfy added
      expect(await adapter.isTokenSupported(token)).to.be.true;
    });

    it("Should fail to add token when sender is not manager", async () => {
      const { user, adapter } = await loadFixture(addChainFixture);

      // add token
      const token = getRandomAddress();
      const addSupportedToken = adapter.connect(user).addSupportedToken(token);
      await expect(addSupportedToken)
        .to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, MANAGER_ROLE);
    });

    it("Should fail to add token when already supported", async () => {
      const { admin, adapter, token } = await loadFixture(addSupportedTokenFixture);

      // verify supported
      expect(await adapter.isTokenSupported(token)).to.be.true;

      // add token
      const addSupportedToken = adapter.connect(admin).addSupportedToken(token);
      await expect(addSupportedToken).to.be.revertedWithCustomError(adapter, "TokenAlreadySupported").withArgs(token);
    });
  });

  describe("Remove Supported Token", () => {
    it("Should successfully remove token", async () => {
      const { admin, adapter, token } = await loadFixture(addSupportedTokenFixture);

      // remove token
      await adapter.connect(admin).removeSupportedToken(token);
      expect(await adapter.isTokenSupported(token)).to.be.false;
    });

    it("Should fail to remove token when sender is not manager", async () => {
      const { user, adapter, token } = await loadFixture(addSupportedTokenFixture);

      // remove token
      const removeSupportedToken = adapter.connect(user).removeSupportedToken(token);
      await expect(removeSupportedToken)
        .to.be.revertedWithCustomError(adapter, "AccessControlUnauthorizedAccount")
        .withArgs(user.address, MANAGER_ROLE);
    });

    it("Should fail to remove token when unsupported", async () => {
      const { admin, adapter } = await loadFixture(addChainFixture);

      // verify not added
      const token = getRandomAddress();
      expect(await adapter.isTokenSupported(token)).to.be.false;

      // remove token
      const removeSupportedToken = adapter.connect(admin).removeSupportedToken(token);
      await expect(removeSupportedToken).to.be.revertedWithCustomError(adapter, "TokenNotSupported").withArgs(token);
    });
  });

  describe("Send Messsage", () => {
    it("Should successfuly send message", async () => {
      const {
        user,
        adapter,
        bridgeRouter,
        relayer,
        folksChainId,
        ccipChainId,
        corrAdapterAddress,
        token,
        tokenAddress,
      } = await loadFixture(addSupportedTokenFixture);

      // balances before
      const adapterBalance = await ethers.provider.getBalance(adapter);
      const relayerNativeBalance = await ethers.provider.getBalance(relayer);
      const userBalance = await token.balanceOf(user);
      const relayerTokenBalance = await token.balanceOf(relayer);

      // manually send token (would normally be done in spoke/hub)
      const amount = BigInt(0.1e18);
      await token.connect(user).transfer(adapter, amount);

      // get fee
      const recipientAddress = getRandomAddress();
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
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
          encodePayloadWithCCIPTokenMetadata(amount, tokenAddress, recipientAddress, message),
          [[tokenAddress, amount]],
          ethers.ZeroAddress,
          ethers.concat([
            "0x97a657c9",
            abiCoder.encode(["uint256"], [convertNumberToBytes(message.params.gasLimit, UINT256_LENGTH)]),
          ])
        );

      // balances after
      expect(await ethers.provider.getBalance(adapter)).to.equal(adapterBalance);
      expect(await ethers.provider.getBalance(relayer)).to.equal(relayerNativeBalance + fee);
      expect(await token.balanceOf(user)).to.equal(userBalance - amount);
      expect(await token.balanceOf(adapter)).to.equal(0);
      expect(await token.balanceOf(relayer)).to.equal(relayerTokenBalance + amount);
      expect(await token.allowance(adapter, relayer)).to.equal(0);
    });

    it("Should fail to send message when chain not added", async () => {
      const { adapter, bridgeRouter, tokenAddress } = await loadFixture(addSupportedTokenFixture);

      // verify not added
      const folksChainId = 23;
      expect(await adapter.isChainAvailable(folksChainId)).to.be.false;

      // get fee
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
      const fee = 10000;

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });

    it("Should fail to send message when sender is not bridge router", async () => {
      const { user, adapter, folksChainId, tokenAddress } = await loadFixture(addSupportedTokenFixture);

      // get fee
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = adapter.connect(user).sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "InvalidBridgeRouter").withArgs(user.address);
    });

    it("Should fail to send message when immediate finality level", async () => {
      const { adapter, bridgeRouter, folksChainId, tokenAddress } = await loadFixture(addSupportedTokenFixture);

      // get fee
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
      message.finalityLevel = Finality.IMMEDIATE;
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidFinalityLevel")
        .withArgs(Finality.IMMEDIATE);
    });

    it("Should fail to send message when receiver value is used", async () => {
      const { adapter, bridgeRouter, folksChainId, tokenAddress } = await loadFixture(addSupportedTokenFixture);

      // get fee
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
      message.params.receiverValue = BigInt(1);
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "UnsupportedReceiverValue");
    });

    it("Should fail to send message when extra args is empty", async () => {
      const { adapter, bridgeRouter, folksChainId, tokenAddress } = await loadFixture(addSupportedTokenFixture);

      // get fee
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
      message.extraArgs = "0x";
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = bridgeRouter.sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "EmptyExtraArgs");
    });

    it("Should fail to send message when extra args is ill defined", async () => {
      const { adapter, bridgeRouter, folksChainId, tokenAddress } = await loadFixture(addSupportedTokenFixture);

      // get fee
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
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

    it("Should fail to send message when token unsupported", async () => {
      const { adapter, bridgeRouter, folksChainId } = await loadFixture(addChainFixture);

      // verify unsupported
      const tokenAddress = getRandomAddress();
      expect(await adapter.isTokenSupported(tokenAddress)).to.be.false;

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
      const { user, adapter, relayer, folksChainId, ccipChainId, corrAdapterAddress, token, tokenAddress } =
        await loadFixture(addSupportedTokenFixture);

      // balance before
      const recipientAddress = getRandomAddress();
      const recipientBalance = await token.balanceOf(recipientAddress);

      // manually send token (would normally be done by relayer)
      const amount = BigInt(0.1e18);
      await token.connect(user).transfer(adapter, amount);

      // construct message
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const ccipMessage: CCIPMessageReceived = {
        messageId,
        sourceChainSelector: BigInt(ccipChainId),
        sender: abiCoder.encode(["address"], [convertGenericAddressToEVMAddress(corrAdapterAddress)]),
        data: encodePayloadWithCCIPTokenMetadata(amount, tokenAddress, recipientAddress, message),
        destTokenAmounts: [{ amount, token: tokenAddress }],
      };

      // receive message
      const receiveMessage = relayer.deliverToAdapter(adapter, ccipMessage);
      await expect(receiveMessage).to.emit(adapter, "ReceiveMessage").withArgs(messageId);

      // balances after
      expect(await token.balanceOf(recipientAddress)).to.equal(recipientBalance + amount);
      expect(await token.balanceOf(adapter)).to.equal(0);
    });

    it("Should fail to receive message when chain when not added", async () => {
      const { adapter, relayer, folksChainId, corrAdapterAddress, tokenAddress } =
        await loadFixture(addSupportedTokenFixture);

      // verify chain unknown
      const ccipChainId = 4;
      expect((await adapter.getChainAdapter(folksChainId))[0]).to.not.equal(ccipChainId);

      // construct message
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const ccipMessage: CCIPMessageReceived = {
        messageId,
        sourceChainSelector: BigInt(ccipChainId),
        sender: abiCoder.encode(["address"], [convertGenericAddressToEVMAddress(corrAdapterAddress)]),
        data: encodePayloadWithCCIPTokenMetadata(amount, tokenAddress, recipientAddress, message),
        destTokenAmounts: [{ amount, token: tokenAddress }],
      };

      // receive message
      const receiveMessage = relayer.deliverToAdapter(adapter, ccipMessage);
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });

    it("Should fail to receive message when message sender is not corresponding adapter", async () => {
      const { adapter, relayer, folksChainId, ccipChainId, tokenAddress } = await loadFixture(addSupportedTokenFixture);

      // verify sender unknown
      const corrAdapterAddress = convertEVMAddressToGenericAddress(getRandomAddress());
      expect((await adapter.getChainAdapter(folksChainId))[1]).to.not.equal(corrAdapterAddress);

      // construct message
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const ccipMessage: CCIPMessageReceived = {
        messageId,
        sourceChainSelector: BigInt(ccipChainId),
        sender: abiCoder.encode(["address"], [convertGenericAddressToEVMAddress(corrAdapterAddress)]),
        data: encodePayloadWithCCIPTokenMetadata(amount, tokenAddress, recipientAddress, message),
        destTokenAmounts: [{ amount, token: tokenAddress }],
      };

      // receive message
      const receiveMessage = relayer.deliverToAdapter(adapter, ccipMessage);
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidMessageSender")
        .withArgs(corrAdapterAddress);
    });

    it("Should fail to receive message when no destination token amount", async () => {
      const { adapter, relayer, folksChainId, corrAdapterAddress, ccipChainId, tokenAddress } =
        await loadFixture(addSupportedTokenFixture);

      // construct message
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const ccipMessage: CCIPMessageReceived = {
        messageId,
        sourceChainSelector: BigInt(ccipChainId),
        sender: abiCoder.encode(["address"], [convertGenericAddressToEVMAddress(corrAdapterAddress)]),
        data: encodePayloadWithCCIPTokenMetadata(amount, tokenAddress, recipientAddress, message),
        destTokenAmounts: [],
      };

      // receive message
      const receiveMessage = relayer.deliverToAdapter(adapter, ccipMessage);
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "InvalidDestTokenAmountsLength");
    });

    it("Should fail to receive message when more than one destination token amount", async () => {
      const { adapter, relayer, folksChainId, corrAdapterAddress, ccipChainId, tokenAddress } =
        await loadFixture(addSupportedTokenFixture);

      // construct message
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const ccipMessage: CCIPMessageReceived = {
        messageId,
        sourceChainSelector: BigInt(ccipChainId),
        sender: abiCoder.encode(["address"], [convertGenericAddressToEVMAddress(corrAdapterAddress)]),
        data: encodePayloadWithCCIPTokenMetadata(amount, tokenAddress, recipientAddress, message),
        destTokenAmounts: [
          { amount, token: tokenAddress },
          { amount: BigInt(1), token: getRandomAddress() },
        ],
      };

      // receive message
      const receiveMessage = relayer.deliverToAdapter(adapter, ccipMessage);
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "InvalidDestTokenAmountsLength");
    });

    it("Should fail to receive message when token unsupported", async () => {
      const { adapter, relayer, folksChainId, corrAdapterAddress, ccipChainId } =
        await loadFixture(addSupportedTokenFixture);

      // verify unsupported
      const tokenAddress = getRandomAddress();
      expect(await adapter.isTokenSupported(tokenAddress)).to.be.false;

      // construct message
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const ccipMessage: CCIPMessageReceived = {
        messageId,
        sourceChainSelector: BigInt(ccipChainId),
        sender: abiCoder.encode(["address"], [convertGenericAddressToEVMAddress(corrAdapterAddress)]),
        data: encodePayloadWithCCIPTokenMetadata(amount, tokenAddress, recipientAddress, message),
        destTokenAmounts: [{ amount, token: tokenAddress }],
      };

      // receive message
      const receiveMessage = relayer.deliverToAdapter(adapter, ccipMessage);
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidTokenAddress")
        .withArgs(convertEVMAddressToGenericAddress(tokenAddress));
    });

    it("Should fail to receive message when amounts differ", async () => {
      const { adapter, relayer, folksChainId, corrAdapterAddress, ccipChainId, tokenAddress } =
        await loadFixture(addSupportedTokenFixture);

      // construct message
      const recipientAddress = getRandomAddress();
      const metadataAmount = BigInt(0.1e18);
      const actualAmount = BigInt(0.05e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, metadataAmount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const ccipMessage: CCIPMessageReceived = {
        messageId,
        sourceChainSelector: BigInt(ccipChainId),
        sender: abiCoder.encode(["address"], [convertGenericAddressToEVMAddress(corrAdapterAddress)]),
        data: encodePayloadWithCCIPTokenMetadata(metadataAmount, tokenAddress, recipientAddress, message),
        destTokenAmounts: [{ amount: actualAmount, token: tokenAddress }],
      };

      // receive message
      const receiveMessage = relayer.deliverToAdapter(adapter, ccipMessage);
      await expect(receiveMessage)
        .to.be.revertedWithCustomError(adapter, "InvalidReceivedAmount")
        .withArgs(metadataAmount, actualAmount);
    });

    it("Should fail to receive message when sender is not ccip relayer", async () => {
      const { admin, adapter, folksChainId, ccipChainId, corrAdapterAddress, tokenAddress } =
        await loadFixture(addSupportedTokenFixture);

      // verify relayer unknown
      const relayer = await new MockCCIPRouterClient__factory(admin).deploy();
      const relayerAddress = await relayer.getAddress();
      expect(await adapter.ccipRouter()).to.not.equal(relayerAddress);

      // construct message
      const recipientAddress = getRandomAddress();
      const amount = BigInt(0.1e18);
      const message = getMessage(folksChainId, tokenAddress, recipientAddress, amount);
      const messageId = getRandomBytes(BYTES32_LENGTH);
      const ccipMessage: CCIPMessageReceived = {
        messageId,
        sourceChainSelector: BigInt(ccipChainId),
        sender: abiCoder.encode(["address"], [convertGenericAddressToEVMAddress(corrAdapterAddress)]),
        data: encodePayloadWithCCIPTokenMetadata(amount, tokenAddress, recipientAddress, message),
        destTokenAmounts: [{ amount, token: tokenAddress }],
      };

      // receive message
      const receiveMessage = relayer.deliverToAdapter(adapter, ccipMessage);
      await expect(receiveMessage).to.be.revertedWithCustomError(adapter, "InvalidRouter").withArgs(relayerAddress);
    });
  });
});
