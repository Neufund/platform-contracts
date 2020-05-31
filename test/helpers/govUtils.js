import { expect } from "chai";
import { soliditySha3 } from "web3-utils";
import { GovExecutionState } from "./govState";
import { eventValue, eventWithIdxValue } from "../helpers/events";
import { ZERO_BYTES32, Q16 } from "../helpers/constants";

export function isTerminalExecutionState(s) {
  return (
    [
      GovExecutionState.Rejected,
      GovExecutionState.Cancelled,
      GovExecutionState.Failed,
      GovExecutionState.Completed,
    ].findIndex(v => v === s) >= 0
  );
}

export function getCommitmentResolutionId(addr) {
  return soliditySha3({ type: "address", value: addr });
}

export function expectLogResolutionExecuted(tx, logIdx, resolutionId, actionType, terminalState) {
  const event = eventWithIdxValue(tx, logIdx, "LogResolutionExecuted");
  expect(event).to.exist;
  expect(event.args.resolutionId).to.eq(resolutionId);
  expect(event.args.action).to.be.bignumber.eq(actionType);
  expect(event.args.state).to.be.bignumber.eq(terminalState);
}

export function expectLogResolutionStarted(
  tx,
  logIdx,
  resolutionId,
  token,
  title,
  documentUrl,
  actionType,
  initialState,
) {
  const event = eventWithIdxValue(tx, logIdx, "LogResolutionStarted");
  expect(event).to.exist;
  expect(event.args.resolutionId).to.eq(resolutionId);
  expect(event.args.token).to.eq(token);
  expect(event.args.resolutionTitle).to.eq(title);
  expect(event.args.documentUrl).to.eq(documentUrl);
  expect(event.args.action).to.be.bignumber.eq(actionType);
  expect(event.args.state).to.be.bignumber.eq(initialState);
}

export function expectLogGovStateTransition(tx, oldState, newState, timestamp) {
  const event = eventValue(tx, "LogGovStateTransition");
  expect(event).to.exist;
  expect(event.args.oldState).to.be.bignumber.eq(oldState);
  expect(event.args.newState).to.be.bignumber.eq(newState);
  if (timestamp) {
    expect(event.args.timestamp).to.be.bignumber.eq(timestamp);
  }
}

export function expectResolution(
  resolution,
  resolutionId,
  action,
  execState,
  failedCode = ZERO_BYTES32,
  cancelAt = 0,
  nextStep = 0,
  payload = ZERO_BYTES32,
) {
  expect(resolution[0]).to.be.bignumber.eq(action);
  expect(resolution[1]).to.be.bignumber.eq(execState);
  expect(resolution[2]).to.be.bignumber.gt(0);
  expect(resolution[6]).to.eq(payload);
  expect(resolution[7]).to.be.bignumber.eq(cancelAt);
  expect(resolution[8]).to.be.bignumber.eq(nextStep);
  if (!isTerminalExecutionState(execState)) {
    // final date
    expect(resolution[3]).to.be.bignumber.eq(0);
    // failed code
    expect(resolution[4]).to.be.bignumber.eq(0);
  } else {
    expect(resolution[3]).to.be.bignumber.gt(0);
    expect(resolution[4]).to.eq(failedCode);
  }
  // resolution[5] is a promise (keccak hash of parameters);
}

export async function expectResolutionById(
  engine,
  resolutionId,
  action,
  execState,
  failedCode = ZERO_BYTES32,
  cancelAt = 0,
  nextStep = 0,
  payload = ZERO_BYTES32,
) {
  const resolution = await engine.resolution(resolutionId);
  expectResolution(
    resolution,
    resolutionId,
    action,
    execState,
    failedCode,
    cancelAt,
    nextStep,
    payload,
  );
}

export function shareCapitalToTokens(shareCapital, tokensPerShare, shareNominalValueUlps) {
  return shareCapital
    .mul(tokensPerShare)
    .div(shareNominalValueUlps)
    .floor();
}

export function prcToFrac(prc) {
  return prc.mul(Q16);
}
