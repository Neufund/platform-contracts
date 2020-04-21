pragma solidity 0.4.26;

import "./ShareholderRights.sol";

// rights of the equity token holder vs. company. derived from ShareholderRights as those represent Nominee rights
// as shareholder and those rights are passed to equity token holders
contract EquityTokenholderRights is ShareholderRights {

    ////////////////////////
    // Public Accessors
    ////////////////////////

    // offchain time to finalize and execute voting;
    uint256 public VOTING_FINALIZATION_DURATION;

    // bylaws for possible actions, where uint56 encodes ActionBylaw
    function ACTION_BYLAWS() public constant returns(uint56[TOTAL_ACTIONS]) {
        return _ACTION_BYLAWS;
    }

    ////////////////////////
    // Immutable State
    ////////////////////////

    uint56[TOTAL_ACTIONS] private _ACTION_BYLAWS;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        bool hasVotingRights,
        uint256 liquidationPreferenceMultiplierFrac,
        bool hasFoundersVesting,
        uint256 votingFinalizationDuration,
        uint56[TOTAL_ACTIONS] actionBylaws
    )
        public
        ShareholderRights(
            hasVotingRights,
            liquidationPreferenceMultiplierFrac,
            hasFoundersVesting
        )
    {
        _ACTION_BYLAWS = actionBylaws;
        VOTING_FINALIZATION_DURATION = votingFinalizationDuration;
    }

    // get bylaw for specific action
    function getBylaw(Action action)
        public
        constant
        returns (uint56)
    {
        return _ACTION_BYLAWS[uint256(action)];
    }

    // get default bylaw - for standard governance action
    function getDefaultBylaw()
        public
        constant
        returns (uint56)
    {
        return _ACTION_BYLAWS[uint256(Action.None)];
    }

    // get restricted act bylaw - for governance action that is restricted act
    function getRestrictedBylaw()
        public
        constant
        returns (uint56)
    {
        return _ACTION_BYLAWS[uint256(Action.RestrictedNone)];
    }

    // decodes uint56 packed bylaw into uint256 array that can be casted from ActionBylaw
    // TODO: switch to solidity 6 for V2 encoder and direct support for bylaws in storage
    function decodeBylaw(uint56 encodedBylaw)
        public
        pure
        returns (uint256[7] memory decodedBylaw)
    {
        ActionBylaw memory bylaw = deserializeBylaw(encodedBylaw);
        // see `deserializeBylaw` for memory layout details
        // ActionBylaw is just uint256[7]
        assembly {
            decodedBylaw := bylaw
        }
    }

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x873e0fca5b3fad6e10062e37990687ec48d68d5d90658d73f1a76ab0b1e0df77, 0);
    }
}
