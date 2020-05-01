import { expect } from "chai";
import { eventValue } from "./events";

export function expectLogDisbursalCreated(
  tx,
  proRataToken,
  token,
  amount,
  disburserAddr,
  recycleDur,
  index,
) {
  const event = eventValue(tx, "LogDisbursalCreated");
  expect(event).to.exist;
  expect(event.args.proRataToken).to.eq(proRataToken);
  expect(event.args.token).to.eq(token);
  expect(event.args.amount).to.be.bignumber.eq(amount);
  expect(event.args.recycleAfterDuration).to.be.bignumber.eq(recycleDur);
  expect(event.args.disburser).to.eq(disburserAddr);
  if (index) {
    expect(event.args.index).to.be.bignumber.eq(index);
  }
}
