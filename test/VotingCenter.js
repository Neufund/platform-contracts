import { testVotingWithSnapshots } from "./helpers/votingTestCases";
import { ZERO_ADDRESS } from "./helpers/constants";

const TestSnapshotToken = artifacts.require("TestSnapshotToken");
const VotingCenter = artifacts.require("VotingCenter");

contract("VotingWithSnaphotToken", ([owner, owner2, ...accounts]) => {
  let testSnapshotToken;
  let votingContract;

  beforeEach(async () => {
    testSnapshotToken = await TestSnapshotToken.new(ZERO_ADDRESS, 0);
    votingContract = await VotingCenter.new(testSnapshotToken.address);
  });

  const getToken = () => testSnapshotToken;
  const getVotingContract = () => votingContract;

  it("test double voting: direct -> direct, direct -> relay, direct -> batch and v. versa");

  testVotingWithSnapshots(getToken, getVotingContract, owner, owner2, accounts[0]);
});
