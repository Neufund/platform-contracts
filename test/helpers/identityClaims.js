const BigNumber = require("./bignumber");
const Web3 = require("web3");

const web3 = new Web3();

export function deserializeClaims(claims) {
  const claimsN = new BigNumber(claims, 16);
  return referenceClaims(
    claimsN.mod(2).eq(1),
    claimsN
      .dividedToIntegerBy(2)
      .mod(2)
      .eq(1),
    claimsN
      .dividedToIntegerBy(4)
      .mod(2)
      .eq(1),
    claimsN
      .dividedToIntegerBy(8)
      .mod(2)
      .eq(1),
  );
}

export function referenceClaims(
  isVerified,
  isSophisticatedInvestor,
  hasBankAccount,
  accountFrozen,
) {
  return [{ isVerified }, { isSophisticatedInvestor }, { hasBankAccount }, { accountFrozen }];
}

export const identityClaims = {
  isNone: 0,
  isVerified: 1,
  isSophisticatedInvestor: 2,
  hasBankAccount: 4,
  isAccountFrozen: 8,
};
