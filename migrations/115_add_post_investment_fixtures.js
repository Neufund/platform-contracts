require("babel-register");
const fs = require("fs");
const { join } = require("path");
const getConfig = require("./config").getConfig;
const getFixtureAccounts = require("./getFixtureAccounts").getFixtureAccounts;
const { GovAction, GovExecutionState } = require("../test/helpers/govState");
const { shareCapitalToTokens } = require("../test/helpers/govUtils");
const { loadEtoFixtures, getEtoFixtureByName, shiftBackTime } = require("./helpers");
const { dayInSeconds } = require("../test/helpers/constants");
const { decodeBylaw } = require("../test/helpers/deployTerms");
const createAccessPolicy = require("../test/helpers/createAccessPolicy").default;
const roles = require("../test/helpers/roles").default;
const stringify = require("../test/helpers/utils").stringify;

module.exports = function deployContracts(deployer, network, accounts) {
  const CONFIG = getConfig(web3, network, accounts);
  if (CONFIG.shouldSkipStep(__filename)) return;
  if (CONFIG.isLiveDeployment) return;

  const Universe = artifacts.require(CONFIG.artifacts.UNIVERSE);
  const TokenController = artifacts.require(CONFIG.artifacts.EQUITY_TOKEN_CONTROLLER);
  const VotingCenter = artifacts.require(CONFIG.artifacts.VOTING_CENTER);
  const EquityToken = artifacts.require(CONFIG.artifacts.STANDARD_EQUITY_TOKEN);
  const TokenholderRights = artifacts.require("ITokenholderRights");
  const RoleBasedAccessPolicy = artifacts.require(CONFIG.artifacts.ROLE_BASED_ACCESS_POLICY);
  const ETOCommitment = artifacts.require(CONFIG.artifacts.STANDARD_ETO_COMMITMENT);

  deployer.then(async () => {
    // get voting center and add issuer as voting initiator
    const fas = getFixtureAccounts(accounts);
    const issuer = fas.ISSUER_PAYOUT.address;
    const universe = await Universe.deployed();
    const votingCenter = await VotingCenter.at(await universe.getSingleton("0xff5dbb18"));
    const accessPolicy = await RoleBasedAccessPolicy.at(await universe.accessPolicy());
    await createAccessPolicy(accessPolicy, [
      { subject: issuer, role: roles.votingInitiator, object: votingCenter.address },
    ]);

    // get payout commitment
    const etoFixtures = loadEtoFixtures();
    const payoutFixture = getEtoFixtureByName(etoFixtures, "ETOInPayoutState");
    const payoutController = await TokenController.at(payoutFixture.tokenController);
    const equityToken = await EquityToken.at(payoutFixture.equityToken);
    const etoCommitment = await ETOCommitment.at(payoutFixture.address);

    // proposals/resolutions must be hardcoded if you use a real ipfs document
    // that has proposal in it's envelope. this is the case in all resolutions below

    // get bylaw for AnnualGeneralMeeting action for which proposal will be created
    const shareholderInformation = await payoutController.shareholderInformation();
    const govToken = await payoutController.governanceToken();
    const tokenholderRights = TokenholderRights.at(govToken[3]);
    const bylaw = await tokenholderRights.getBylaw(GovAction.AnnualGeneralMeeting);
    const decodedBylaw = decodeBylaw(GovAction.AnnualGeneralMeeting, `0x0${bylaw.toString(16)}`);

    async function shareCapitalVotingPower(shareCapital) {
      return shareCapitalToTokens(
        shareCapital,
        await equityToken.tokensPerShare(),
        await equityToken.shareNominalValueUlps(),
      );
    }

    const totalVotingPower = await shareCapitalVotingPower(shareholderInformation[0]);

    // proposal in final state with NO
    const finalProposalId = "0x260336115aa587536ea0a8630c5b4cbf9da56a5a1577443beb7eb56ccfb25644";
    console.log(`opening final proposal ${finalProposalId}`);
    await votingCenter.addProposal(
      finalProposalId,
      equityToken.address,
      0,
      0,
      // one day for voting
      dayInSeconds,
      issuer,
      // two days to finalize
      2 * dayInSeconds,
      totalVotingPower,
      GovAction.CompanyNone,
      // ipfs document below will be deployed by the backend
      "Free Lunch Resolution FINAL NO,ipfs:QmSEmMkXWkTZ9mNyYQjxvJLiJQkiaMVY2Ho5A24HYTEcCa",
      false,
      { from: issuer },
    );
    // more than 50% votes NO
    let remainingVoters = Object.keys(payoutFixture.investors);
    remainingVoters = await castVotes(finalProposalId, remainingVoters, false, "0.5", votingCenter);
    // 10% votes YES
    await castVotes(finalProposalId, remainingVoters, true, "0.6", votingCenter);
    // shift two days to land in the middle of finalization period
    await shiftBackTime(
      etoCommitment,
      payoutController,
      votingCenter,
      equityToken,
      2 * dayInSeconds,
    );
    await votingCenter._shiftProposalDeadlines(finalProposalId, 2 * dayInSeconds);
    // provide offchain finalization results 60%, 10% no, rest is token + abstained
    await votingCenter.addOffchainVote(
      finalProposalId,
      totalVotingPower.mul("0.6").floor(),
      totalVotingPower.mul("0.1").floor(),
      // final result document deployed on the backend
      "ipfs:QmPTH1V5quKycFo3z9iaaCEiwc91DFhZQ5fRCupHFtgSoG",
      { from: issuer },
    );

    // proposal in nominee YES for tally state
    const tallyProposalId = "0x1e3943098338f486e09c2c3f2f6347c3646fe7c96da47c11b77d0c9a0b7bb880";
    console.log(`opening tally proposal ${tallyProposalId}`);
    await votingCenter.addProposal(
      tallyProposalId,
      equityToken.address,
      0,
      0,
      // single day for voting
      dayInSeconds,
      issuer,
      // full voting period for tally
      decodedBylaw[2],
      totalVotingPower,
      GovAction.CompanyNone,
      // ipfs document below will be deployed by the backend
      "Extraordinary Shareholder Meeting TALLY YES,ipfs:QmTetEmvLsbP2oNoZzKCwgEQBSNGTiSb29nWsu15h3eqwG",
      false,
      { from: issuer },
    );
    // 30% votes NO
    remainingVoters = Object.keys(payoutFixture.investors);
    remainingVoters = await castVotes(tallyProposalId, remainingVoters, false, "0.3", votingCenter);
    // 10% votes YES
    remainingVoters = await castVotes(tallyProposalId, remainingVoters, true, "0.4", votingCenter);
    // shift all contracts 1 day to go into tally
    await shiftBackTime(etoCommitment, payoutController, votingCenter, equityToken, dayInSeconds);
    await votingCenter._shiftProposalDeadlines(finalProposalId, dayInSeconds);
    await votingCenter._shiftProposalDeadlines(tallyProposalId, dayInSeconds);

    // create proposal that will stay current
    const proposalId = "0x6400a3523bc839d6bad3232d118c4234d9ef6b2408ca6afcadcbff728f06d220";
    console.log(`opening independent proposal ${proposalId}`);
    await votingCenter.addProposal(
      proposalId,
      equityToken.address,
      0,
      0,
      decodedBylaw[2],
      issuer,
      decodedBylaw[2],
      totalVotingPower,
      GovAction.AnnualGeneralMeeting,
      // ipfs document below will be deployed by the backend
      "General Meeting 2020 Resolution,ipfs:QmYKcra5eRZLSdmoFDRX8uD65bfPj8AbaRreYiAPNtoEKk",
      false,
      { from: issuer },
    );

    const generalInfoRID = "0x57cd9bf3f51b148c4b1e353719485a92f81ffcc3824a9b628446b0f4e4f01a6b";
    console.log(`executing general information with ${generalInfoRID}`);
    await payoutController.generalResolution(
      generalInfoRID,
      GovAction.CompanyNone,
      "A general information from ISSUER_PAYOUT 2020",
      // TODO: generate fancy document
      "ipfs:QmdMo4GqAsZVyXBh6iJsL4n2DqrEjehMaJbjZBCAaMzD1Q",
      { from: issuer },
    );
    // issue annual meeting resolution (SHR escalation)
    // note that offering, token and token controller were time-shifted
    // to provide balances at past snapshot
    const annualRID = "0x880b841d14fcd67b241bd96e031b0af256d80778605e17508cfa6711ce0e296d";
    console.log(`executing annual meeting resolution ${annualRID}`);
    await payoutController.generalResolution(
      annualRID,
      GovAction.AnnualGeneralMeeting,
      "A Notice of General Meeting 2020",
      "ipfs:QmdMo4GqAsZVyXBh6iJsL4n2DqrEjehMaJbjZBCAaMzD1Q",
      { from: issuer },
    );

    // dump post investment state
    const proposalIds = [proposalId, tallyProposalId, finalProposalId];
    const controllers = {};
    // dump all controllers and collect open proposals
    async function describeResolutions(controller) {
      const resolutions = {};
      const ids = await controller.resolutionsList();
      for (const id of ids) {
        resolutions[id] = await controller.resolution(id);
        // add to proposals to describe from voting center
        if (resolutions[id][1] === GovExecutionState.Escalating) {
          proposalIds.push(id);
        }
      }
      return resolutions;
    }

    for (const addr of Object.keys(etoFixtures)) {
      const etoFixture = etoFixtures[addr];
      const controller = await TokenController.at(etoFixture.tokenController);
      const controllerDesc = {
        address: addr,
        name: etoFixture.name,
        company: etoFixture.company,
        resolutions: await describeResolutions(controller),
        shareholderInformation: await controller.shareholderInformation(),
        governanceToken: await controller.governanceToken(),
        tokenOfferings: await controller.tokenOfferings(),
        moduleIds: await controller.moduleId(),
        contractId: await controller.contractId(),
      };
      controllers[addr] = stringify(controllerDesc);
    }
    // dump all proposals from voting center
    const openProposals = {};
    for (const propId of proposalIds) {
      openProposals[propId] = {
        proposal: await votingCenter.timedProposal(propId),
        tally: await votingCenter.tally(propId),
      };
    }
    const postInvestmentDesc = {
      controllers,
      openProposals,
    };
    const postInvestmentPath = join(__dirname, "../build/post_investment.json");
    fs.writeFile(postInvestmentPath, JSON.stringify(postInvestmentDesc, null, 2), err => {
      if (err) throw new Error(err);
    });
    console.log(`Post-Investment described in ${postInvestmentPath}`);
  });

  async function castVotes(proposalId, voters, inFavor, minVotingPowerFrac, votingCenter) {
    let voted = 0;
    for (const voter of voters) {
      console.log(
        `${voter} votes ${inFavor} with ${await votingCenter.getVotingPower(proposalId, voter)}`,
      );
      await votingCenter.vote(proposalId, inFavor, { from: voter });
      const tally = await votingCenter.tally(proposalId);
      voted += 1;
      // console.log(tally);
      if (tally[2].gt(tally[5].mul(minVotingPowerFrac))) {
        break;
      }
    }
    return voters.slice(voted);
  }
};
