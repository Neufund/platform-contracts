const BigNumber = require("../helpers/bignumber");

export function etherToWei(number) {
  return new BigNumber(web3.toWei(number, "ether"));
}

export function shanToWei(number) {
  return new BigNumber(web3.toWei(number, "shannon"));
}

export const divRound = (v, d) =>
  d
    .dividedToIntegerBy(2)
    .plus(v)
    .dividedToIntegerBy(d);
