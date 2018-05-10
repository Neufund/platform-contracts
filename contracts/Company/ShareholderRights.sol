pragma solidity 0.4.23;


contract ShareholderRights {

    enum VotingRule {
        // shareholder has no voting rights
        NoVotingRights,
        // shareholder votes yes if token holders do not say otherwise
        Positive,
        // shareholder votes agains if token holders do not say otherwise
        Negative
    }

    // a right to drag along (or be dragged) on exit
    bool public HAS_DRAG_ALONG_RIGHTS;
    // a right to tag along
    bool public HAS_TAG_ALONG_RIGHTS;
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
    uint256 public GENERAL_VOTING_DURATION_DAYS;
    // duration of restricted act votings (like exit etc.)
    uint256 public RESTRICTED_ACT_VOTING_DURATION_DAYS;
    // {gen-general-resolutions-voting-duration-days}
    // {gen-liquidation-preference-muliplier}
    // Founders-vesting

}
