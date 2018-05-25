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
    bool public constant HAS_FOUNDERS_VESTING = true;
    // duration of general voting in days
    uint256 public constant GENERAL_VOTING_DURATION_DAYS = 10;
    // duration of restricted act votings (like exit etc.)
    uint256 public constant RESTRICTED_ACT_VOTING_DURATION_DAYS = 14;
    // quorum of tokenholders for the vote to count as decimal fraction
    uint256 public constant TOKENHOLDERS_QUORUM_FRAC = 10**17; // 10%
    // {gen-general-resolutions-voting-duration-days}
    // {gen-liquidation-preference-muliplier}
    // Founders-vesting

}
