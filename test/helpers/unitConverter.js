const BigNumber = web3.BigNumber;

export function etherToWei(number) {
  return new BigNumber(web3.toWei(number, "ether"));
}

export function shanToWei(number) {
  return new BigNumber(web3.toWei(number, "shannon"));
}

export const divRound = (v, d) =>
  d
    .divToInt(2)
    .plus(v)
    .divToInt(d);
