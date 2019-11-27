import { deployTestReceiver } from "./helpers/tokenTestCases";
import { mockReceiverTests } from "./helpers/mockReceiverTestCases";

contract("Test Receiver", ([account1]) => {
  let receiver;
  const getReceiver = () => receiver;
  beforeEach(async () => {
    receiver = await deployTestReceiver(true);
  });

  mockReceiverTests(getReceiver, account1);
});
