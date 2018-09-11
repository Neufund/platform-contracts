import { expect } from "chai";
import { eventValue } from "./events";

export function expectLogFundsCommitted(
  tx,
  investor,
  wallet,
  paymentTokenAddress,
  amount,
  eurEquiv,
  expectedEquity,
  equityTokenAddress,
  expectedNeu,
) {
  const event = eventValue(tx, "LogFundsCommitted");
  expect(event).to.exist;
  expect(event.args.investor).to.eq(investor);
  expect(event.args.wallet).to.eq(wallet);
  expect(event.args.paymentToken).to.eq(paymentTokenAddress);
  expect(event.args.amount).to.be.bignumber.eq(amount);
  expect(event.args.baseCurrencyEquivalent).to.be.bignumber.eq(eurEquiv);
  expect(event.args.grantedAmount).to.be.bignumber.eq(expectedEquity);
  expect(event.args.assetToken).to.eq(equityTokenAddress);
  expect(event.args.neuReward).to.be.bignumber.eq(expectedNeu);
}
