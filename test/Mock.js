
import { expect } from "chai";
import EvmError from "./helpers/EVMThrow";
import {
  deployTestReceiving,
} from "./helpers/tokenTestCases";
import { mockReceiverTests } from "./helpers/mockReceiverTestCases";
// const Neumark = artifacts.require("TestNeumark");

contract("Test Receiver", ([account1, ...accounts]) => {
  let receiver;
  const getReceiver = () => receiver;
  beforeEach(async () => {
    receiver = await deployTestReceiving(true);
  });

  mockReceiverTests(getReceiver, account1);
});
