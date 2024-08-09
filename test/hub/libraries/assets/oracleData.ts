import { unixTime } from "../../utils/formulae";
import { SECONDS_IN_MINUTE } from "../../../utils/time";

export enum NodeType {
  NONE,
  CHAINLINK,
  PYTH,
  PRICE_DEVIATION_CIRCUIT_BREAKER,
  PRICE_DEVIATION_SAME_ORACLE_CIRCUIT_BREAKER,
  STALENESS_CIRCUIT_BREAKER,
  CONSTANT,
  REDUCER,
  EXTERNAL,
}

export interface NodeOutputData {
  price: bigint;
  timestamp: bigint;
  nodeType: NodeType;
  additionalParam1: bigint;
  additionalParam2: bigint;
}

export interface PriceFeed {
  price: bigint;
  decimals: bigint;
}

export const getNodeOutputData = (price: bigint): NodeOutputData => ({
  price,
  timestamp: BigInt(unixTime() - SECONDS_IN_MINUTE),
  nodeType: NodeType.CHAINLINK,
  additionalParam1: BigInt(1),
  additionalParam2: BigInt(2),
});
