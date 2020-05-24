pragma solidity 0.4.26;

import "../Standards/IContractId.sol";


// represents a set of rights that shareholder ("nominee" in case of equity token with nominee structure) has
// in case of tokens that do not have equity-like rights (debt/notes) some flags will be set to off, more research needed
contract ShareholderRights is IContractId {

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
        public
    {
        HAS_VOTING_RIGHTS = hasVotingRights;
        LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC = liquidationPreferenceMultiplierFrac;
        HAS_FOUNDERS_VESTING = hasFoundersVesting;
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x7f46caed28b4e7a90dc4db9bba18d1565e6c4824f0dc1b96b3b88d730da56e57, 1);
    }
}
