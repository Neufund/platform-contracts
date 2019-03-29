const { BigNumber } = require("bignumber.js");

BigNumber.prototype.round = function(dp, rm) {
  const n = new BigNumber(this);
  if (dp) {
    return new BigNumber(n.toPrecision(dp, rm));
  } else {
    return new BigNumber(n.toPrecision());
  }
};

module.exports = BigNumber;
