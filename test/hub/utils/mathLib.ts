const SECONDS_IN_YEAR = BigInt(365 * 24 * 60 * 60);
const HOURS_IN_YEAR = BigInt(365 * 24);

const ONE_2_DP = BigInt(1e2);
const ONE_4_DP = BigInt(1e4);
const ONE_6_DP = BigInt(1e6);
const ONE_10_DP = BigInt(1e10);
const ONE_12_DP = BigInt(1e12);
const ONE_14_DP = BigInt(1e14);
const ONE_18_DP = BigInt(1e18);

const UINT64 = BigInt(2) << BigInt(63);
const UINT128 = BigInt(2) << BigInt(127);

function maximum(n1: bigint, n2: bigint): bigint {
  return n1 > n2 ? n1 : n2;
}

function minimum(n1: bigint, n2: bigint): bigint {
  return n1 < n2 ? n1 : n2;
}

function mulScale(n1: bigint, n2: bigint, scale: bigint): bigint {
  return (n1 * n2) / scale;
}

function mulScaleRoundUp(n1: bigint, n2: bigint, scale: bigint): bigint {
  const remainder = (n1 * n2) % scale;
  const roundUp = remainder > BigInt(0) ? BigInt(1) : BigInt(0);
  return mulScale(n1, n2, scale) + roundUp;
}

function divScale(n1: bigint, n2: bigint, scale: bigint): bigint {
  return (n1 * scale) / n2;
}

function divScaleRoundUp(n1: bigint, n2: bigint, scale: bigint): bigint {
  const remainder = (n1 * scale) % n2;
  const roundUp = remainder > BigInt(0) ? BigInt(1) : BigInt(0);
  return divScale(n1, n2, scale) + roundUp;
}

function expBySquaring(x: bigint, n: bigint, scale: bigint): bigint {
  if (n === BigInt(0)) return scale;

  let y = scale;
  while (n > BigInt(1)) {
    if (n % BigInt(2)) {
      y = mulScale(x, y, scale);
      n = (n - BigInt(1)) / BigInt(2);
    } else {
      n = n / BigInt(2);
    }
    x = mulScale(x, x, scale);
  }
  return mulScale(x, y, scale);
}

function compound(rate: bigint, scale: bigint, period: bigint): bigint {
  return expBySquaring(scale + rate / period, period, scale) - scale;
}

function compoundEverySecond(rate: bigint, scale: bigint): bigint {
  return compound(rate, scale, SECONDS_IN_YEAR);
}

function compoundEveryHour(rate: bigint, scale: bigint): bigint {
  return compound(rate, scale, HOURS_IN_YEAR);
}

function sqrt(value: bigint): bigint {
  if (value < BigInt(0)) throw Error("square root of negative numbers is not supported");

  if (value < BigInt(2)) return value;

  function newtonIteration(n: bigint, x0: bigint): bigint {
    const x1 = (n / x0 + x0) >> BigInt(1);
    if (x0 === x1 || x0 === x1 - BigInt(1)) return x0;
    return newtonIteration(n, x1);
  }

  return newtonIteration(value, BigInt(1));
}

export {
  SECONDS_IN_YEAR,
  HOURS_IN_YEAR,
  ONE_18_DP,
  ONE_14_DP,
  ONE_12_DP,
  ONE_10_DP,
  ONE_6_DP,
  ONE_4_DP,
  ONE_2_DP,
  UINT64,
  UINT128,
  maximum,
  minimum,
  mulScale,
  mulScaleRoundUp,
  divScale,
  divScaleRoundUp,
  expBySquaring,
  compoundEverySecond,
  compoundEveryHour,
  sqrt,
};
