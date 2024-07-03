import { ethers } from "hardhat";

export const SECONDS_IN_MINUTE = 60;
export const SECONDS_IN_HOUR = 60 * SECONDS_IN_MINUTE;
export const SECONDS_IN_DAY = 24 * SECONDS_IN_HOUR;
export const SECONDS_IN_WEEK = 7 * SECONDS_IN_DAY;
export const SECONDS_IN_YEAR = 365 * SECONDS_IN_DAY;

export async function getLatestBlockTimestamp(): Promise<number> {
  const latestBlock = await ethers.provider.getBlock("latest");
  if (latestBlock === null) throw Error("No block");
  return latestBlock.timestamp;
}

export function getRandomInt(max: number | bigint) {
  return Math.floor(Math.random() * Number(max));
}
