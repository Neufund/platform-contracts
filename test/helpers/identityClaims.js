const Web3 = require("web3");
const toBytes32 = require("./constants").toBytes32;

const web3 = new Web3();

export const identityClaims = {
  isNone: 0,
  isVerified: 1,
  isSophisticatedInvestor: 2,
  hasBankAccount: 4,
  isAccountFrozen: 8,
};

export function serializeClaims(
  isVerified,
  isSophisticatedInvestor,
  hasBankAccount,
  isAccountFrozen,
) {
  const claims =
    (isVerified ? identityClaims.isVerified : 0) +
    (isSophisticatedInvestor ? identityClaims.isSophisticatedInvestor : 0) +
    (hasBankAccount ? identityClaims.hasBankAccount : 0) +
    (isAccountFrozen ? identityClaims.isAccountFrozen : 0);

  return toBytes32(claims);
}

export function deserializeClaims(claims) {
  const claimsN = new web3.BigNumber(claims, 16);
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
