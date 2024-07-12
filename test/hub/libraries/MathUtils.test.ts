import { expect } from "chai";
import { ethers } from "hardhat";
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
import { MockMathUtilsConsumer, MockMathUtilsConsumer__factory } from "../../../typechain-types";
import { getInitialPoolData } from "./assets/poolData";

describe("MathUtils", async function () {
  let mockMathUtilsConsumer: MockMathUtilsConsumer;

  beforeEach("Deploy MockMathUtilsConsumer contract", async function () {
    const [user] = await ethers.getSigners();
    mockMathUtilsConsumer = await new MockMathUtilsConsumer__factory(user).deploy();
    await mockMathUtilsConsumer.waitForDeployment();
  });

  describe("Check MathUtils lib with FF lib", async function () {
    const PRECISION = BigInt(0);
    const diffErrMsg: (a: bigint, b: bigint) => string = (a, b) => `Diff: ${a - b}`;

    describe("Test pool data mocks", async function () {
      const poolDataMocks = [getInitialPoolData()];
      poolDataMocks.forEach((poolDataMock) => {
        const totalDebt = poolDataMock.variableBorrowData.totalAmount + poolDataMock.stableBorrowData.totalAmount;
        const utilizationRatio = calcUtilisationRatio(totalDebt, poolDataMock.depositData.totalAmount);

        describe("Test variable borrow interest rate", async function () {
          let ut: bigint = utilizationRatio;
          let uopt: bigint = poolDataMock.depositData.optimalUtilisationRatio;

          const calcVariableBorrowInterestRateGTandSC = async (ut: bigint, uopt: bigint) => {
            return {
              borrowInterestRateGT: calcVariableBorrowInterestRate(
                poolDataMock.variableBorrowData.vr0,
                poolDataMock.variableBorrowData.vr1,
                poolDataMock.variableBorrowData.vr2,
                ut,
                uopt
              ),
              borrowInterestRate: await mockMathUtilsConsumer.calcVariableBorrowInterestRate(
                poolDataMock.variableBorrowData.vr0,
                poolDataMock.variableBorrowData.vr1,
                poolDataMock.variableBorrowData.vr2,
                ut,
                uopt
              ),
            };
          };

          it("Should return variable borrow interest rate with ut < uopt", async function () {
            [ut, uopt] = ut < uopt ? [ut, uopt] : [uopt, ut];

            const { borrowInterestRateGT, borrowInterestRate } = await calcVariableBorrowInterestRateGTandSC(ut, uopt);

            expect(borrowInterestRate, diffErrMsg(borrowInterestRate, borrowInterestRateGT)).to.be.closeTo(
              borrowInterestRateGT,
              PRECISION
            );
          });

          it("Should return variable borrow interest rate with ut >= uopt", async function () {
            [ut, uopt] = ut >= uopt ? [ut, uopt] : [uopt, ut];

            const { borrowInterestRateGT, borrowInterestRate } = await calcVariableBorrowInterestRateGTandSC(ut, uopt);

            expect(borrowInterestRate, diffErrMsg(borrowInterestRate, borrowInterestRateGT)).to.be.closeTo(
              borrowInterestRateGT,
              PRECISION
            );
          });
        });

        describe("Test stable borrow interest rate", async function () {
          let ut: bigint = utilizationRatio;
          let uopt: bigint = poolDataMock.depositData.optimalUtilisationRatio;
          let ratiot: bigint = calcStableDebtToTotalDebtRatio(poolDataMock.stableBorrowData.totalAmount, totalDebt);
          let ratioopt: bigint = poolDataMock.stableBorrowData.optimalStableToTotalDebtRatio;

          const calcStableBorrowInterestRateGTandSC = async (
            ut: bigint,
            uopt: bigint,
            ratiot: bigint,
            ratioopt: bigint
          ) => {
            return {
              borrowStableInterestRateGT: calcStableBorrowInterestRate(
                poolDataMock.variableBorrowData.vr0,
                poolDataMock.stableBorrowData.sr0,
                poolDataMock.stableBorrowData.sr1,
                poolDataMock.stableBorrowData.sr2,
                poolDataMock.stableBorrowData.sr3,
                ut,
                uopt,
                ratiot,
                ratioopt
              ),
              borrowStableInterestRate: await mockMathUtilsConsumer.calcStableBorrowInterestRate(
                poolDataMock.variableBorrowData.vr0,
                poolDataMock.stableBorrowData.sr0,
                poolDataMock.stableBorrowData.sr1,
                poolDataMock.stableBorrowData.sr2,
                poolDataMock.stableBorrowData.sr3,
                ut,
                uopt,
                ratiot,
                ratioopt
              ),
            };
          };

          it("Should return stable borrow interest rate with ut <= uopt and ratiot <= ratioopt", async function () {
            [ut, uopt] = ut <= uopt ? [ut, uopt] : [uopt, ut];
            [ratiot, ratioopt] = ratiot <= ratioopt ? [ratiot, ratioopt] : [ratioopt, ratiot];

            const { borrowStableInterestRateGT, borrowStableInterestRate } = await calcStableBorrowInterestRateGTandSC(
              ut,
              uopt,
              ratiot,
              ratioopt
            );

            expect(
              borrowStableInterestRate,
              diffErrMsg(borrowStableInterestRate, borrowStableInterestRateGT)
            ).to.be.closeTo(borrowStableInterestRateGT, PRECISION);
          });

          it("Should return stable borrow interest rate with ut <= uopt and ratiot > ratioopt", async function () {
            [ut, uopt] = ut <= uopt ? [ut, uopt] : [uopt, ut];
            [ratiot, ratioopt] = ratiot > ratioopt ? [ratiot, ratioopt] : [ratioopt, ratiot];

            const { borrowStableInterestRateGT, borrowStableInterestRate } = await calcStableBorrowInterestRateGTandSC(
              ut,
              uopt,
              ratiot,
              ratioopt
            );

            expect(
              borrowStableInterestRate,
              diffErrMsg(borrowStableInterestRate, borrowStableInterestRateGT)
            ).to.be.closeTo(borrowStableInterestRateGT, PRECISION);
          });

          it("Should return stable borrow interest rate with ut > uopt and ratiot <= ratioopt", async function () {
            [ut, uopt] = ut > uopt ? [ut, uopt] : [uopt, ut];
            [ratiot, ratioopt] = ratiot <= ratioopt ? [ratiot, ratioopt] : [ratioopt, ratiot];

            const { borrowStableInterestRateGT, borrowStableInterestRate } = await calcStableBorrowInterestRateGTandSC(
              ut,
              uopt,
              ratiot,
              ratioopt
            );

            expect(
              borrowStableInterestRate,
              diffErrMsg(borrowStableInterestRate, borrowStableInterestRateGT)
            ).to.be.closeTo(borrowStableInterestRateGT, PRECISION);
          });

          it("Should return stable borrow interest rate with ut > uopt and ratiot > ratioopt", async function () {
            [ut, uopt] = ut > uopt ? [ut, uopt] : [uopt, ut];
            [ratiot, ratioopt] = ratiot > ratioopt ? [ratiot, ratioopt] : [ratioopt, ratiot];

            const { borrowStableInterestRateGT, borrowStableInterestRate } = await calcStableBorrowInterestRateGTandSC(
              ut,
              uopt,
              ratiot,
              ratioopt
            );

            expect(
              borrowStableInterestRate,
              diffErrMsg(borrowStableInterestRate, borrowStableInterestRateGT)
            ).to.be.closeTo(borrowStableInterestRateGT, PRECISION);
          });
        });

        describe("Test overall borrow interest rate", async function () {
          let tdbt = totalDebt;

          const calcOverallBorrowInterestRateGTandSC = async (tdbt: bigint) => {
            return {
              overallBorrowInterestRateGT: calcOverallBorrowInterestRate(
                poolDataMock.variableBorrowData.totalAmount,
                poolDataMock.stableBorrowData.totalAmount,
                poolDataMock.variableBorrowData.interestRate,
                poolDataMock.stableBorrowData.averageInterestRate
              ),
              overallBorrowInterestRate: await mockMathUtilsConsumer.calcOverallBorrowInterestRate(
                poolDataMock.variableBorrowData.totalAmount,
                poolDataMock.stableBorrowData.totalAmount,
                poolDataMock.variableBorrowData.interestRate,
                poolDataMock.stableBorrowData.averageInterestRate
              ),
            };
          };

          it("Should return overall borrow interest rate with totalDeposit 0", async function () {
            tdbt = tdbt > 0n ? 0n : tdbt;

            const { overallBorrowInterestRateGT, overallBorrowInterestRate } =
              await calcOverallBorrowInterestRateGTandSC(tdbt);

            expect(
              overallBorrowInterestRate,
              diffErrMsg(overallBorrowInterestRate, overallBorrowInterestRateGT)
            ).to.be.closeTo(overallBorrowInterestRateGT, PRECISION);
          });

          it("Should return overall borrow interest rate with totalDeposit > 0", async function () {
            tdbt = tdbt > 0n ? tdbt : BigInt(Math.random() * 1e18);

            const { overallBorrowInterestRateGT, overallBorrowInterestRate } =
              await calcOverallBorrowInterestRateGTandSC(tdbt);

            expect(
              overallBorrowInterestRate,
              diffErrMsg(overallBorrowInterestRate, overallBorrowInterestRateGT)
            ).to.be.closeTo(overallBorrowInterestRateGT, PRECISION);
          });
        });

        it("Should return deposit interest rate", async function () {
          let tdbt = totalDebt > 0n ? totalDebt : BigInt(Math.random() * 1e18);

          const overallBorrowInterestRateGT = calcOverallBorrowInterestRate(
            poolDataMock.variableBorrowData.totalAmount,
            poolDataMock.stableBorrowData.totalAmount,
            poolDataMock.variableBorrowData.interestRate,
            poolDataMock.stableBorrowData.averageInterestRate
          );

          const depositInterestRateGT = calcDepositInterestRate(
            overallBorrowInterestRateGT,
            poolDataMock.feeData.retentionRate,
            utilizationRatio
          );

          const depositInterestRate = await mockMathUtilsConsumer.calcDepositInterestRate(
            utilizationRatio,
            overallBorrowInterestRateGT,
            poolDataMock.feeData.retentionRate
          );

          expect(depositInterestRate, diffErrMsg(depositInterestRate, depositInterestRateGT)).to.be.closeTo(
            depositInterestRateGT,
            PRECISION
          );
        });

        describe("Test borrow interest index", async function () {
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
            it(`Should return borrow interest index with time delta ${timeDelta} secs.`, async function () {
              const borrowInterestIndexGT = calcBorrowInterestIndex(
                poolDataMock.variableBorrowData.interestRate,
                poolDataMock.variableBorrowData.interestIndex,
                BigInt(unixTime()) - timeDelta
              );

              const borrowInterestIndex = await mockMathUtilsConsumer.calcBorrowInterestIndex(
                poolDataMock.variableBorrowData.interestRate,
                poolDataMock.variableBorrowData.interestIndex,
                timeDelta
              );

              expect(
                borrowInterestIndex,
                `Secs: ${timeDelta} ` + diffErrMsg(borrowInterestIndex, borrowInterestIndexGT)
              ).to.be.closeTo(borrowInterestIndexGT, PRECISION);
            });
          });
        });

        describe("Test deposit interest index", async function () {
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
            it(`Should return deposit interest index with time delta ${timeDelta} secs.`, async function () {
              const depositInterestIndexGT = calcDepositInterestIndex(
                poolDataMock.depositData.interestRate,
                poolDataMock.depositData.interestIndex,
                BigInt(unixTime()) - timeDelta
              );

              const depositInterestIndex = await mockMathUtilsConsumer.calcDepositInterestIndex(
                poolDataMock.depositData.interestRate,
                poolDataMock.depositData.interestIndex,
                timeDelta
              );

              expect(
                depositInterestIndex,
                `Secs: ${timeDelta} ` + diffErrMsg(depositInterestIndex, depositInterestIndexGT)
              ).to.be.closeTo(depositInterestIndexGT, PRECISION);
            });
          });
        });
      });
    });
  });
});
