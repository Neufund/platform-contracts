pragma solidity 0.4.26;

import "./GovernanceTypes.sol";
import "../Standards/IContractId.sol";


// represents a set of rights that shareholder (nominee in case of equity token) has.
contract ShareholderRights is GovernanceTypes, IContractId {

    ////////////////////////
    // Immutable state
    ////////////////////////

    // a right to drag along (or be dragged) on exit
    bool public constant HAS_DRAG_ALONG_RIGHTS = true;
    // a right to tag along
    bool public constant HAS_TAG_ALONG_RIGHTS = true;
    // information is fundamental right that cannot be removed
    bool public constant HAS_GENERAL_INFORMATION_RIGHTS = true;
    // has voting rights
    bool public HAS_VOTING_RIGHTS;
    // liquidation preference multiplicator as decimal fraction
    uint256 public LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC;
    // founder's vesting
    bool public HAS_FOUNDERS_VESTING;
    // duration of general voting
    uint256 public GENERAL_VOTING_DURATION;
    // duration of restricted act votings (like exit etc.)
    uint256 public RESTRICTED_ACT_VOTING_DURATION;
    // quorum of shareholders for the vote to count as decimal fraction
    uint256 public SHAREHOLDERS_VOTING_QUORUM_FRAC;
    // number of tokens voting / total supply must be more than this to count the vote
    uint256 public VOTING_MAJORITY_FRAC;

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
