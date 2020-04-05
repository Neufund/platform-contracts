pragma solidity 0.4.26;

import "./ShareholderRights.sol";

// rights of the equity token holder vs. company. derived from ShareholderRights as those represent Nominee rights
// as shareholder and those rights are passed to equity token holders
contract EquityTokenholderRights is ShareholderRights {
    // voting Right
    VotingRule public GENERAL_VOTING_RULE;
    // voting rights in tag along
    VotingRule public TAG_ALONG_VOTING_RULE;
    // offchain time to finalize and execute voting;
    uint256 public VOTING_FINALIZATION_DURATION;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        VotingRule generalVotingRule,
        VotingRule tagAlongVotingRule,
        uint256 liquidationPreferenceMultiplierFrac,
        bool hasFoundersVesting,
        uint256 generalVotingDuration,
        uint256 restrictedActVotingDuration,
        uint256 votingFinalizationDuration,
        uint256 shareholdersVotingQuorumFrac,
        uint256 votingMajorityFrac
    )
        public
        ShareholderRights(
            generalVotingRule != VotingRule.NoVotingRights,
            liquidationPreferenceMultiplierFrac,
            hasFoundersVesting,
            generalVotingDuration,
            restrictedActVotingDuration,
            shareholdersVotingQuorumFrac,
            votingMajorityFrac
        )
    {
        // todo: revise requires
        require(uint(generalVotingRule) < 4);
        require(uint(tagAlongVotingRule) < 4);

        GENERAL_VOTING_RULE = generalVotingRule;
        TAG_ALONG_VOTING_RULE = tagAlongVotingRule;
        VOTING_FINALIZATION_DURATION = votingFinalizationDuration;
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x873e0fca5b3fad6e10062e37990687ec48d68d5d90658d73f1a76ab0b1e0df77, 0);
    }
}
