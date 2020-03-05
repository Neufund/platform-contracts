import { testVotingWithSnapshots } from "../../helpers/votingTestCases";
import { ZERO_ADDRESS } from "../../helpers/constants";

const TestSnapshotToken = artifacts.require("TestSnapshotToken");
const SimpleVote = artifacts.require("SimpleVote");

contract("VotingWithSnaphotToken", ([owner, owner2, ...accounts]) => {
  let testSnapshotToken;
  let votingContract;

  beforeEach(async () => {
    testSnapshotToken = await TestSnapshotToken.new(ZERO_ADDRESS, 0);
    votingContract = await SimpleVote.new(testSnapshotToken.address, /* VotingPeriodInDays: */ 3);
  });

  const getToken = () => testSnapshotToken;
  const getVotingContract = () => votingContract;

  testVotingWithSnapshots(getToken, getVotingContract, owner, owner2, accounts[0]);
});
