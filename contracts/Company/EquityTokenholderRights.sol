pragma solidity 0.4.26;

import "./ShareholderRights.sol";
import "./ITokenholderRights.sol";
import "./Gov.sol";


// rights of the equity token holder vs. company. derived from ShareholderRights as those represent Nominee rights
// that are passed to the token holders. derived from the ITokenholderRights for generic bylaws support
contract EquityTokenholderRights is
    ITokenholderRights,
    ShareholderRights
{

    ////////////////////////
    // Constants
    ////////////////////////

    // number of actions declared by Action enum
    uint256 internal constant TOTAL_ACTIONS = 26;

    // number of actions declared by Action enum
    uint256 internal constant BYLAW_STRUCT_PROPS = 9;

    ////////////////////////
    // Public Accessors
    ////////////////////////

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
    }

    //
    // Implements ITokenholderRights
    //

    function getBylaw(uint8 action)
        public
        constant
        returns (uint56)
    {
        return _ACTION_BYLAWS[action];
    }

    // TODO: switch to solidity 6 for V2 encoder and direct support for bylaws in storage
    // TODO: if holder rights implemented for other token types move to base constract
    function decodeBylaw(uint56 encodedBylaw)
        public
        pure
        returns (uint256[BYLAW_STRUCT_PROPS] memory decodedBylaw)
    {
        Gov.ActionBylaw memory bylaw = Gov.deserializeBylaw(encodedBylaw);
        // see `deserializeBylaw` for memory layout details
        // ActionBylaw is just uint256[9]
        assembly {
            decodedBylaw := bylaw
        }
    }

    //
    // Specific functions
    //

    // get default bylaw - for standard governance action
    function getDefaultBylaw()
        public
        constant
        returns (uint56)
    {
        return _ACTION_BYLAWS[uint256(Gov.Action.None)];
    }

    // get restricted act bylaw - for governance action that is restricted act
    function getRestrictedBylaw()
        public
        constant
        returns (uint56)
    {
        return _ACTION_BYLAWS[uint256(Gov.Action.RestrictedNone)];
    }

    //
    // Utility function
    //

    //
    // Implements IContractId
    //

    function contractId() public pure returns (bytes32 id, uint256 version) {
        return (0x873e0fca5b3fad6e10062e37990687ec48d68d5d90658d73f1a76ab0b1e0df77, 0);
    }
}
