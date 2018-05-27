pragma solidity 0.4.24;


contract ShareholderRights {

    enum VotingRule {
        // nominee has no voting rights
        NoVotingRights,
        // nominee votes yes if token holders do not say otherwise
        Positive,
        // nominee votes against if token holders do not say otherwise
        Negative,
        // nominee passes the vote as is giving yes/no split
        Proportional
    }

    // a right to drag along (or be dragged) on exit
    bool public constant HAS_DRAG_ALONG_RIGHTS = true;
    // a right to tag along
    bool public constant HAS_TAG_ALONG_RIGHTS = true;
    // information is fundamental right that cannot be removed
    bool public constant HAS_GENERAL_INFORMATION_RIGHTS = true;
    // voting Right
    VotingRule public GENERAL_VOTING_RULE;
    // voting rights in tag along
    VotingRule public TAG_ALONG_VOTING_RULE;
    // liquidation preference multiplicator as decimal fraction
    uint256 public LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC;
    // founder's vesting
    bool public HAS_FOUNDERS_VESTING;
    // duration of general voting in days
    uint256 public GENERAL_VOTING_DURATION;
    // duration of restricted act votings (like exit etc.)
    uint256 public RESTRICTED_ACT_VOTING_DURATION;
    // offchain time to finalize and execute voting;
    uint256 public VOTING_FINALIZATION;
    // quorum of tokenholders for the vote to count as decimal fraction
    uint256 public TOKENHOLDERS_QUORUM_FRAC = 10**17; // 10%

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        VotingRule generalVotingRule,
        VotingRule tagAlongVotingRule,
        uint256 liquidationPreferenceFrac,
        bool hasFoundersVesting,
        uint256 generalVotingDuration,
        uint256 restrictedActVotingDuration,
        uint256 votingFinalization,
        uint256 tokenholdersQuorumFrac
    )
        public
    {
        // todo: revise requires
        require(uint(generalVotingRule) < 4);
        require(uint(tagAlongVotingRule) < 4);
        // quorum < 100%
        require(tokenholdersQuorumFrac < 10**18);

        GENERAL_VOTING_RULE = generalVotingRule;
        TAG_ALONG_VOTING_RULE = tagAlongVotingRule;
        LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC = liquidationPreferenceFrac;
        HAS_FOUNDERS_VESTING = hasFoundersVesting;
        GENERAL_VOTING_DURATION = generalVotingDuration;
        RESTRICTED_ACT_VOTING_DURATION = restrictedActVotingDuration;
        VOTING_FINALIZATION = votingFinalization;
        TOKENHOLDERS_QUORUM_FRAC = tokenholdersQuorumFrac;
    }
}
