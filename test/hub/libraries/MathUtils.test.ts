import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { MockMathUtilsConsumer, MockMathUtilsConsumer__factory } from "../../../typechain-types";
import { getRandomInt } from "../../utils/time";
import {
  calcBorrowInterestIndex,
  calcDepositInterestIndex,
  calcDepositInterestRate,
  calcOverallBorrowInterestRate,
  calcStableBorrowInterestRate,
  calcStableDebtToTotalDebtRatio,
  calcUtilisationRatio,
  calcVariableBorrowInterestRate,
  unixTime,
} from "../utils/formulae";

describe("MathUtils", () => {
  async function deployMathUtilsFixture() {
    const [user] = await ethers.getSigners();
    const mathUtils = await new MockMathUtilsConsumer__factory(user).deploy();
    return { user, mathUtils };
  }

  describe("Calc stable borrow ratio", () => {
    const data = [
      [BigInt(0), BigInt(50e6), BigInt(0)],
      [BigInt(50e6), BigInt(50e6), BigInt(1e18)],
      [BigInt(10e6), BigInt(50e6), BigInt(0.2e18)],
      [BigInt(21.325845e6), BigInt(3253.0925e6), BigInt(BigInt(0.006555560593496803e18))],
    ];

    data.forEach(([sba, al, sbr]) => {
      it(`Should return stable borrow ratio for ${sba}/${al}`, async () => {
        const { mathUtils } = await loadFixture(deployMathUtilsFixture);
        const ratio = await mathUtils.calcStableBorrowRatio(sba, al);
        expect(ratio).to.equal(sbr);
      });
    });

    it("Should revert when stable borrow ratio greater than one", async () => {
      const { mathUtils } = await loadFixture(deployMathUtilsFixture);
      const sba = BigInt(1e6);
      const al = sba - BigInt(1);
      const calcStableBorrowRatio = mathUtils.calcStableBorrowRatio(sba, al);
      await expect(calcStableBorrowRatio).to.be.revertedWithCustomError(mathUtils, "RatioExceedsOne");
    });
  });

  describe("Calc utilisation ratio", () => {
    const data = [
      [BigInt(0), BigInt(50e6), BigInt(0)],
      [BigInt(50e6), BigInt(50e6), BigInt(1e18)],
      [BigInt(10e6), BigInt(50e6), BigInt(0.2e18)],
      [BigInt(21.325845e6), BigInt(3253.0925e6), BigInt(BigInt(0.006555560593496803e18))],
    ];

    data.forEach(([tb, td, ur]) => {
      it(`Should return utilisation ratio for ${tb}/${td}`, async () => {
        const { mathUtils } = await loadFixture(deployMathUtilsFixture);
        const ratio = await mathUtils.calcUtilisationRatio(tb, td);
        expect(ratio).to.equal(ur);
      });
    });

    it("Should revert when utilisation ratio greater than one", async () => {
      const { mathUtils } = await loadFixture(deployMathUtilsFixture);
      const tb = BigInt(1e6);
      const td = tb - BigInt(1);
      const calcStableBorrowRatio = mathUtils.calcUtilisationRatio(tb, td);
      await expect(calcStableBorrowRatio).to.be.revertedWithCustomError(mathUtils, "RatioExceedsOne");
    });
  });

  describe("Calc stable debt to total debt ratio", () => {
    const data = [
      [BigInt(0), BigInt(50e6), BigInt(0)],
      [BigInt(50e6), BigInt(50e6), BigInt(1e18)],
      [BigInt(10e6), BigInt(50e6), BigInt(0.2e18)],
      [BigInt(21.325845e6), BigInt(3253.0925e6), BigInt(BigInt(0.006555560593496803e18))],
    ];

    data.forEach(([tsb, tb, sbttbr]) => {
      it(`Should return stable debt to total debt ratio for ${tsb}/${tb}`, async () => {
        const { mathUtils } = await loadFixture(deployMathUtilsFixture);
        const ratio = await mathUtils.calcUtilisationRatio(tsb, tb);
        expect(ratio).to.equal(sbttbr);
      });
    });

    it("Should revert when stable debt to total debt ratio greater than one", async () => {
      const { mathUtils } = await loadFixture(deployMathUtilsFixture);
      const tsb = BigInt(1e6);
      const tb = tsb - BigInt(1);
      const calcStableBorrowRatio = mathUtils.calcUtilisationRatio(tsb, tb);
      await expect(calcStableBorrowRatio).to.be.revertedWithCustomError(mathUtils, "RatioExceedsOne");
    });
  });

  describe("Calc variable borrow interest rate", () => {
    it("Should return variable borrow interest rate with ut < uopt", async () => {
      const { mathUtils } = await loadFixture(deployMathUtilsFixture);
      const vr0 = BigInt(0.01e6);
      const vr1 = BigInt(0.05e6);
      const vr2 = BigInt(1e6);
      const ut = BigInt(0.23853287534e18);
      const uopt = BigInt(0.75e4);
      const expected = calcVariableBorrowInterestRate(vr0, vr1, vr2, ut, uopt);

      const actual = await mathUtils.calcVariableBorrowInterestRate(vr0, vr1, vr2, ut, uopt);
      expect(actual).to.equal(expected);
    });

    it("Should return variable borrow interest rate with ut >= uopt", async () => {
      const { mathUtils } = await loadFixture(deployMathUtilsFixture);
      const vr0 = BigInt(0.01e6);
      const vr1 = BigInt(0.05e6);
      const vr2 = BigInt(1e6);
      const ut = BigInt(0.9125375302e18);
      const uopt = BigInt(0.75e4);
      const expected = calcVariableBorrowInterestRate(vr0, vr1, vr2, ut, uopt);

      const actual = await mathUtils.calcVariableBorrowInterestRate(vr0, vr1, vr2, ut, uopt);
      expect(actual).to.equal(expected);
    });
  });

  describe("Calc stable borrow interest rate", () => {
    it("Should return stable borrow interest rate with no excess and ut < uopt", async () => {
      const { mathUtils } = await loadFixture(deployMathUtilsFixture);
      const vr1 = BigInt(0.05e6);
      const sr0 = BigInt(0.01e6);
      const sr1 = BigInt(0.02e6);
      const sr2 = BigInt(2e6);
      const sr3 = BigInt(0.2e6);
      const ut = BigInt(0.23853287534e18);
      const uopt = BigInt(0.75e4);
      const rt = BigInt(0.3423e4);
      const ropt = BigInt(0.4e4);
      const expected = calcStableBorrowInterestRate(vr1, sr0, sr1, sr2, sr3, ut, uopt, rt, ropt);

      const actual = await mathUtils.calcStableBorrowInterestRate(vr1, sr0, sr1, sr2, sr3, ut, uopt, rt, ropt);
      expect(actual).to.equal(expected);
    });

    it("Should return variable borrow interest rate with no excess and ut >= uopt", async () => {
      const { mathUtils } = await loadFixture(deployMathUtilsFixture);
      const vr1 = BigInt(0.05e6);
      const sr0 = BigInt(0.01e6);
      const sr1 = BigInt(0.02e6);
      const sr2 = BigInt(2e6);
      const sr3 = BigInt(0.2e6);
      const ut = BigInt(0.9125375302e18);
      const uopt = BigInt(0.75e4);
      const rt = BigInt(0.3423e4);
      const ropt = BigInt(0.4e4);
      const expected = calcStableBorrowInterestRate(vr1, sr0, sr1, sr2, sr3, ut, uopt, rt, ropt);

      const actual = await mathUtils.calcStableBorrowInterestRate(vr1, sr0, sr1, sr2, sr3, ut, uopt, rt, ropt);
      expect(actual).to.equal(expected);
    });

    it("Should return stable borrow interest rate with excess and ut < uopt", async () => {
      const { mathUtils } = await loadFixture(deployMathUtilsFixture);
      const vr1 = BigInt(0.05e6);
      const sr0 = BigInt(0.01e6);
      const sr1 = BigInt(0.02e6);
      const sr2 = BigInt(2e6);
      const sr3 = BigInt(0.2e6);
      const ut = BigInt(0.23853287534e18);
      const uopt = BigInt(0.75e4);
      const rt = BigInt(0.5099e4);
      const ropt = BigInt(0.4e4);
      const expected = calcStableBorrowInterestRate(vr1, sr0, sr1, sr2, sr3, ut, uopt, rt, ropt);

      const actual = await mathUtils.calcStableBorrowInterestRate(vr1, sr0, sr1, sr2, sr3, ut, uopt, rt, ropt);
      expect(actual).to.equal(expected);
    });

    it("Should return variable borrow interest rate with excess and ut >= uopt", async () => {
      const { mathUtils } = await loadFixture(deployMathUtilsFixture);
      const vr1 = BigInt(0.05e6);
      const sr0 = BigInt(0.01e6);
      const sr1 = BigInt(0.02e6);
      const sr2 = BigInt(2e6);
      const sr3 = BigInt(0.2e6);
      const ut = BigInt(0.9125375302e18);
      const uopt = BigInt(0.75e4);
      const rt = BigInt(0.5099e4);
      const ropt = BigInt(0.4e4);
      const expected = calcStableBorrowInterestRate(vr1, sr0, sr1, sr2, sr3, ut, uopt, rt, ropt);

      const actual = await mathUtils.calcStableBorrowInterestRate(vr1, sr0, sr1, sr2, sr3, ut, uopt, rt, ropt);
      expect(actual).to.equal(expected);
    });
  });

  describe("Calc overall borrow interest rate", () => {
    it("Should return overall borrow interest rate when total deposit > 0", async () => {
      const { mathUtils } = await loadFixture(deployMathUtilsFixture);
      const tvb = BigInt(40735.35272e6);
      const tsb = BigInt(952.285899e6);
      const vbir = BigInt(0.08105386599e18);
      const asbir = BigInt(0.1258463736e18);
      const expected = calcOverallBorrowInterestRate(tvb, tsb, vbir, asbir);

      const actual = await mathUtils.calcOverallBorrowInterestRate(tvb, tsb, vbir, asbir);
      expect(actual).to.equal(expected);
    });

    it("Should return overall borrow interest rate when total debt = 0", async () => {
      const { mathUtils } = await loadFixture(deployMathUtilsFixture);
      const tvb = BigInt(0);
      const tsb = BigInt(0);
      const vbir = BigInt(0.08105386599e18);
      const asbir = BigInt(0.1258463736e18);

      const actual = await mathUtils.calcOverallBorrowInterestRate(tvb, tsb, vbir, asbir);
      expect(actual).to.equal(BigInt(0));
    });
  });

  describe("Calc deposit interest rate", () => {
    it("Should return deposit borrow interest rate", async () => {
      const { mathUtils } = await loadFixture(deployMathUtilsFixture);
      const ut = BigInt(0.23853287534e18);
      const obir = BigInt(0.10285305275e18);
      const rr = BigInt(0.1e6);
      const expected = calcDepositInterestRate(ut, obir, rr);

      const actual = await mathUtils.calcDepositInterestRate(ut, obir, rr);
      expect(actual).to.equal(expected);
    });
  });

  describe("Borrow interest index", () => {
    const timeDeltas = [
      1n,
      60n,
      60n * 30n,
      60n * 60n,
      12n * 60n * 60n,
      24n * 60n * 60n,
      30n * 24n * 60n * 60n,
      3n * 30n * 24n * 60n * 60n,
      6n * 30n * 24n * 60n * 60n,
      12n * 30n * 24n * 60n * 60n,
    ];

    timeDeltas.forEach((timeDelta) => {
      it(`Should return borrow interest index with time delta ${timeDelta} secs`, async () => {
        const { mathUtils } = await loadFixture(deployMathUtilsFixture);

        const borrowInterestRate = BigInt(getRandomInt(1e18));
        const oldBorrowInterestIndex = BigInt(1e18) + BigInt(getRandomInt(1e18));
        const expected = calcBorrowInterestIndex(borrowInterestRate, oldBorrowInterestIndex, timeDelta, true);

        const actual = await mathUtils.calcBorrowInterestIndex(borrowInterestRate, oldBorrowInterestIndex, timeDelta);
        expect(actual).to.equal(expected);
      });
    });
  });

  describe("Deposit interest index", () => {
    const timeDeltas = [
      1n,
      60n,
      60n * 30n,
      60n * 60n,
      12n * 60n * 60n,
      24n * 60n * 60n,
      30n * 24n * 60n * 60n,
      3n * 30n * 24n * 60n * 60n,
      6n * 30n * 24n * 60n * 60n,
      12n * 30n * 24n * 60n * 60n,
    ];

    timeDeltas.forEach((timeDelta) => {
      it(`Should return deposit interest index with time delta ${timeDelta} secs`, async () => {
        const { mathUtils } = await loadFixture(deployMathUtilsFixture);

        const depositInterestRate = BigInt(getRandomInt(1e18));
        const oldDepositInterestIndex = BigInt(1e18) + BigInt(getRandomInt(1e18));
        const expected = calcDepositInterestIndex(depositInterestRate, oldDepositInterestIndex, timeDelta, true);

        const actual = await mathUtils.calcDepositInterestIndex(
          depositInterestRate,
          oldDepositInterestIndex,
          timeDelta
        );
        expect(actual).to.equal(expected);
      });
    });
  });
});
