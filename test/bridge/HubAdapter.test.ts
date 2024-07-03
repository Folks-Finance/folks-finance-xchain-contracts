import { expect } from "chai";
import { ethers } from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { BridgeRouterSender__factory, HubAdapter__factory, SimpleERC20Token__factory } from "../../typechain-types";
import {
  BYTES32_LENGTH,
  UINT256_LENGTH,
  convertEVMAddressToGenericAddress,
  convertNumberToBytes,
  getAccountIdBytes,
  getRandomAddress,
} from "../utils/bytes";
import {
  Finality,
  MessageParams,
  MessageToSend,
  buildMessagePayload,
  extraArgsToBytes,
} from "../utils/messages/messages";

describe("HubAdapter (unit tests)", () => {
  const prefix = ethers.zeroPadBytes(ethers.hexlify(Buffer.from("HUB_ADAPTER_V1")), BYTES32_LENGTH);
  const getMessageId = (seq: number | bigint) =>
    ethers.keccak256(ethers.concat([prefix, convertNumberToBytes(seq, UINT256_LENGTH)]));

  const getMessageParams = (): MessageParams => ({
    adapterId: BigInt(0),
    receiverValue: BigInt(0),
    gasLimit: BigInt(30000),
    returnAdapterId: BigInt(0),
    returnGasLimit: BigInt(0),
  });

  const getMessage = (destChainId: number, extraArgs: string): MessageToSend => ({
    params: getMessageParams(),
    sender: convertEVMAddressToGenericAddress(getRandomAddress()),
    destinationChainId: BigInt(destChainId),
    handler: convertEVMAddressToGenericAddress(getRandomAddress()),
    payload: buildMessagePayload(0, getAccountIdBytes("ACCOUNT_ID"), getRandomAddress(), "0x"),
    finalityLevel: Finality.FINALISED,
    extraArgs,
  });

  async function deployHubAdapterFixture() {
    const [admin, user, ...unusedUsers] = await ethers.getSigners();

    // deploy adapter
    const bridgeRouterSpoke = await new BridgeRouterSender__factory(admin).deploy();
    const bridgeRouterHub = await new BridgeRouterSender__factory(admin).deploy();
    const hubChainId = 1;
    const adapter = await new HubAdapter__factory(user).deploy(bridgeRouterSpoke, bridgeRouterHub, hubChainId);
    await bridgeRouterSpoke.setAdapter(adapter);
    await bridgeRouterHub.setAdapter(adapter);

    return { admin, user, unusedUsers, adapter, bridgeRouterSpoke, bridgeRouterHub, hubChainId };
  }

  describe("Deployment", () => {
    it("Should set bridge router and hub chain correctly", async () => {
      const { adapter, bridgeRouterSpoke, bridgeRouterHub, hubChainId } = await loadFixture(deployHubAdapterFixture);

      // check state
      expect(await adapter.bridgeRouterSpoke()).to.equal(bridgeRouterSpoke);
      expect(await adapter.bridgeRouterHub()).to.equal(bridgeRouterHub);
      expect(await adapter.hubChainId()).to.equal(hubChainId);
      expect(await adapter.sequence()).to.equal(0);
      expect(await adapter.PREFIX()).to.equal(prefix);
    });
  });

  describe("Get Send Fee", () => {
    it("Should successfully return the receive value", async () => {
      const { adapter, hubChainId } = await loadFixture(deployHubAdapterFixture);

      const message = getMessage(hubChainId, "0x");
      const receiverValue = BigInt(50000);
      message.params.receiverValue = receiverValue;

      // get send fee
      const fee = await adapter.getSendFee(message);
      expect(fee).to.equal(receiverValue);
    });
  });

  describe("Send Message", () => {
    it("Should successfuly send message without token", async () => {
      const { adapter, bridgeRouterSpoke, bridgeRouterHub, hubChainId } = await loadFixture(deployHubAdapterFixture);

      // balances before
      const adapterBalance = await ethers.provider.getBalance(adapter);
      const bridgeRouterSpokeBalance = await ethers.provider.getBalance(bridgeRouterSpoke);
      const bridgeRouterHubBalance = await ethers.provider.getBalance(bridgeRouterHub);

      // get fee
      const message = getMessage(hubChainId, "0x");
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = await bridgeRouterSpoke.sendMessage(message, { value: fee });
      await expect(sendMessage).to.emit(adapter, "SendMessage").withArgs(getMessageId(0), anyValue);
      await expect(sendMessage).to.emit(adapter, "ReceiveMessage").withArgs(getMessageId(0));

      // balances after
      expect(await ethers.provider.getBalance(adapter)).to.equal(adapterBalance);
      expect(await ethers.provider.getBalance(bridgeRouterSpoke)).to.equal(bridgeRouterSpokeBalance - fee);
      expect(await ethers.provider.getBalance(bridgeRouterHub)).to.equal(bridgeRouterHubBalance + fee);

      // state after
      expect(await adapter.sequence()).to.equal(1);
    });

    it("Should successfuly send message with token", async () => {
      const { user, adapter, bridgeRouterSpoke, bridgeRouterHub, hubChainId } =
        await loadFixture(deployHubAdapterFixture);

      // deploy token and fund user
      const token = await new SimpleERC20Token__factory(user).deploy("USD Coin", "USDC");
      await token.mint(user, BigInt(1000e18));
      const tokenAddress = await token.getAddress();

      // balances before
      const adapterBalance = await ethers.provider.getBalance(adapter);
      const bridgeRouterSpokeBalance = await ethers.provider.getBalance(bridgeRouterSpoke);
      const bridgeRouterHubBalance = await ethers.provider.getBalance(bridgeRouterHub);
      const userBalance = await token.balanceOf(user);

      // manually send token (would normally be done in spoke/hub)
      const amount = BigInt(0.1e18);
      await token.connect(user).transfer(adapter, amount);

      // get fee
      const recipientAddress = getRandomAddress();
      const extraArgs = extraArgsToBytes(tokenAddress, recipientAddress, amount);
      const message = getMessage(hubChainId, extraArgs);
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = await bridgeRouterHub.sendMessage(message, { value: fee });
      await expect(sendMessage).to.emit(adapter, "SendMessage").withArgs(getMessageId(0), anyValue);
      await expect(sendMessage).to.emit(adapter, "ReceiveMessage").withArgs(getMessageId(0));

      // balances after
      expect(await ethers.provider.getBalance(adapter)).to.equal(adapterBalance);
      expect(await ethers.provider.getBalance(bridgeRouterSpoke)).to.equal(bridgeRouterSpokeBalance + fee);
      expect(await ethers.provider.getBalance(bridgeRouterHub)).to.equal(bridgeRouterHubBalance - fee);
      expect(await token.balanceOf(user)).to.equal(userBalance - amount);
      expect(await token.balanceOf(adapter)).to.equal(0);
      expect(await token.balanceOf(recipientAddress)).to.equal(amount);

      // state after
      expect(await adapter.sequence()).to.equal(1);
    });

    it("Should successfuly send multiple message", async () => {
      const { adapter, bridgeRouterSpoke, hubChainId } = await loadFixture(deployHubAdapterFixture);

      // send message
      const message = getMessage(hubChainId, "0x");
      await bridgeRouterSpoke.sendMessage(message);

      // send message again
      const sendMessage = await bridgeRouterSpoke.sendMessage(message);
      await expect(sendMessage).to.emit(adapter, "SendMessage").withArgs(getMessageId(1), anyValue);
      await expect(sendMessage).to.emit(adapter, "ReceiveMessage").withArgs(getMessageId(1));

      // state after
      expect(await adapter.sequence()).to.equal(2);
    });

    it("Should fail to send message when destination chain is not hub chain", async () => {
      const { adapter, bridgeRouterSpoke } = await loadFixture(deployHubAdapterFixture);

      // verify not hub chain
      const folksChainId = 23;
      expect(await adapter.isChainAvailable(folksChainId)).to.be.false;

      // get fee
      const message = getMessage(folksChainId, "0x");
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = bridgeRouterSpoke.sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "ChainUnavailable").withArgs(folksChainId);
    });

    it("Should fail to send message when sender is not bridge router", async () => {
      const { user, adapter, hubChainId } = await loadFixture(deployHubAdapterFixture);

      // get fee
      const message = getMessage(hubChainId, "0x");
      const fee = await adapter.getSendFee(message);

      // send message
      const sendMessage = adapter.connect(user).sendMessage(message, { value: fee });
      await expect(sendMessage).to.be.revertedWithCustomError(adapter, "InvalidBridgeRouter").withArgs(user.address);
    });
  });
});
