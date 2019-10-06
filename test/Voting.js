import { testVotingWithSnapshots } from "./helpers/votingTestCases";
import { ZERO_ADDRESS } from "./helpers/constants";

// this is just a convenience testfile so I dont have always have to run the entire SnapshotTokentestsuite

const TestSnapshotToken = artifacts.require("TestSnapshotToken");
const SimpleVote = artifacts.require("SimpleVote");

contract("VotingWithSnaphotTokenn", ([owner, owner2]) => {
  let testSnapshotToken;
  let votingContract;

  beforeEach(async () => {
    testSnapshotToken = await TestSnapshotToken.new(ZERO_ADDRESS, 0);
    votingContract = await SimpleVote.new(testSnapshotToken.address, /* VotingPeriodInDays: */ 3);
  });

  const getToken = () => testSnapshotToken;
  const getVotingContract = () => votingContract;

  testVotingWithSnapshots(getToken, getVotingContract, owner, owner2);
});
