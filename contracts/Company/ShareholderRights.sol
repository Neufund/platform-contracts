pragma solidity 0.4.26;

import "./GovernanceTypes.sol";
import "../Standards/IContractId.sol";


contract ShareholderRights is GovernanceTypes, IContractId {

    ////////////////////////
    // Immutable state
    ////////////////////////

    // todo: split into ShareholderRights and TokenholderRigths where the first one corresponds to rights of real shareholder (nominee, founder)
    // and the second one corresponds to the list of the token holder (which does not own shares but have identical rights (equity token))
    // or has a debt token with very different rights
    // TokenholderRights will be attached to a token via TokenController and will for example say if token participates in dividends or shareholder resolutins

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
    // duration of general voting
    uint256 public GENERAL_VOTING_DURATION;
    // duration of restricted act votings (like exit etc.)
    uint256 public RESTRICTED_ACT_VOTING_DURATION;
    // offchain time to finalize and execute voting;
    uint256 public VOTING_FINALIZATION_DURATION;
    // quorum of shareholders for the vote to count as decimal fraction
    uint256 public SHAREHOLDERS_VOTING_QUORUM_FRAC;
    // number of tokens voting / total supply must be more than this to count the vote
    uint256 public VOTING_MAJORITY_FRAC = 10**17; // 10%
    // url (typically IPFS hash) to investment agreement between nominee and company
    string public INVESTMENT_AGREEMENT_TEMPLATE_URL;

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
        uint256 votingMajorityFrac,
        string investmentAgreementTemplateUrl
    )
        public
    {
        // todo: revise requires
        require(uint(generalVotingRule) < 4);
        require(uint(tagAlongVotingRule) < 4);
        // quorum < 100%
        require(shareholdersVotingQuorumFrac <= 10**18);
        require(bytes(investmentAgreementTemplateUrl).length != 0);

        GENERAL_VOTING_RULE = generalVotingRule;
        TAG_ALONG_VOTING_RULE = tagAlongVotingRule;
        LIQUIDATION_PREFERENCE_MULTIPLIER_FRAC = liquidationPreferenceMultiplierFrac;
        HAS_FOUNDERS_VESTING = hasFoundersVesting;
        GENERAL_VOTING_DURATION = generalVotingDuration;
        RESTRICTED_ACT_VOTING_DURATION = restrictedActVotingDuration;
        VOTING_FINALIZATION_DURATION = votingFinalizationDuration;
        SHAREHOLDERS_VOTING_QUORUM_FRAC = shareholdersVotingQuorumFrac;
        VOTING_MAJORITY_FRAC = votingMajorityFrac;
        INVESTMENT_AGREEMENT_TEMPLATE_URL = investmentAgreementTemplateUrl;
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x7f46caed28b4e7a90dc4db9bba18d1565e6c4824f0dc1b96b3b88d730da56e57, 0);
    }
}
