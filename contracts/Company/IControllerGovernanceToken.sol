pragma solidity 0.4.26;

import "./Gov.sol";


/// @title interface of governance module to manage governance (main) token of the controller
/// @dev interface assumes single governance token that is a default token for voting and proceed distribution
///      governance token is optional, it's possible to setup a controller without any token
contract IControllerGovernanceToken {

    ////////////////////////
    // Governance Module Id
    ////////////////////////

    bytes32 internal constant ControllerGovernanceTokenId = 0x156c4a2914517b2fdbf2f694bac9d69e03910b75d3298033e1f4f431b517703d;
    uint256 internal constant ControllerGovernanceTokenV = 0;

    ////////////////////////
    // Events
    ////////////////////////

    // logged when transferability of given token was changed
    event LogTransfersStateChanged(
        bytes32 indexed resolutionId,
        address equityToken,
        bool transfersEnabled
    );

    ////////////////////////
    // Interface methods
    ////////////////////////

    function governanceToken()
        public
        constant
        returns (
            IControlledToken token,
            Gov.TokenType tokenType,
            Gov.TokenState tokenState,
            ITokenholderRights holderRights,
            bool tokenTransferable
        );
}
