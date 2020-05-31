pragma solidity 0.4.26;


// represents a set of rights that shareholder ("nominee" in case of equity token with nominee structure) has
// those rights are fully/partially passed to the token holders, see EquityTokenholderRights
contract ShareholderRights {

    ////////////////////////
    // Immutable state
    ////////////////////////

    // a right to drag along (or be dragged) on exit
    bool public constant HAS_DRAG_ALONG_RIGHTS = true;
    // a right to tag along
    bool public constant HAS_TAG_ALONG_RIGHTS = true;
    // access to company information
    bool public constant HAS_GENERAL_INFORMATION_RIGHTS = true;
    // rights to receive dividends and other proceedings
    bool public constant HAS_ECONOMIC_RIGHTS = true;
    // has voting rights
    bool public HAS_VOTING_RIGHTS;
    // liquidation preference multiplicator as decimal fraction
    uint256 public LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC;
    // founder's vesting
    bool public HAS_FOUNDERS_VESTING;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        bool hasVotingRights,
        uint256 liquidationPreferenceMultiplierFrac,
        bool hasFoundersVesting
    )
        internal
    {
        HAS_VOTING_RIGHTS = hasVotingRights;
        LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC = liquidationPreferenceMultiplierFrac;
        HAS_FOUNDERS_VESTING = hasFoundersVesting;
    }
}
