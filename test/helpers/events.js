import { expect } from "chai";
import SolidityEvent from "web3/lib/web3/event";

// const SolidityEvent = require("");

export function logParser(logs, abi) {
  // pattern similar to lib/web3/contract.js:  addEventsToContract()
  const decoders = abi
    .filter(json => json.type === "event")
    // note first and third params required only by enocde and execute;
    // so don't call those!
    .map(json => new SolidityEvent(null, json, null));

  return logs.map(log =>
    decoders.find(decoder => decoder.signature() === log.topics[0].replace("0x", "")).decode(log),
  );
}

export function hasEvent(tx, eventName) {
  expect(tx).to.have.property("logs");
  return tx.logs.find(e => e.event === eventName) !== undefined;
}

export function eventValue(tx, eventName, parName) {
  const events = tx.logs.filter(e => e.event === eventName);
  expect(events, `Event ${eventName} not found in logs`).to.not.be.empty;
  expect(events, `Multiple ${eventName} events found in logs`).to.have.lengthOf(1);
  const event = events[0];
  if (parName) {
    expect(event.args, `Parameter ${parName} not in ${eventName} event`).to.have.property(parName);
    return event.args[parName];
  }
  return event;
}

export function eventValueAtIndex(tx, index, eventName, parName) {
  const events = tx.logs.filter(e => e.event === eventName);
  expect(events, `Event ${eventName} not found in logs`).to.not.be.empty;
  expect(events.length, `Multiple ${eventName} events found in logs`).to.be.greaterThan(index - 1);
  const event = events[index];
  if (parName) {
    expect(event.args, `Parameter ${parName} not in ${eventName} event`).to.have.property(parName);
    return event.args[parName];
  }
  return event;
}

export function eventWithIdxValue(tx, logIdx, eventName, parName) {
  const events = tx.logs.filter(e => e.event === eventName);
  expect(events, `Event ${eventName} not found in logs`).to.not.be.empty;
  expect(events.length, `Event ${eventName} with index ${logIdx} not found in logs`).gte(
    logIdx + 1,
  );
  const event = events[logIdx];
  if (parName) {
    expect(event.args, `Parameter ${parName} not in ${eventName} event`).to.have.property(parName);
    return event.args[parName];
  }
  return event;
}

export function decodeLogs(tx, address, abi) {
  const logs = tx.receipt.logs.filter(l => l.address === address);
  return logParser(logs, abi);
}
