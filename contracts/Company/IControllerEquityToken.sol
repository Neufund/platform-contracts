pragma solidity 0.4.26;

import "./Gov.sol";


/// @title interface of governance module to manage governance (main) token of the controller
/// @dev interface assumes single governance token that is a default token for voting and proceed distribution
///      governance token is optional, it's possible to setup a controller without any token
contract IControllerEquityToken {

    ////////////////////////
    // Governance Module Id
    ////////////////////////

    bytes32 internal constant ControllerEquityTokenId = 0x76a4af32c7ac3d96283e121f8ebe6756f83a719635f832b64ad5c6da800ed89f;
    uint256 internal constant ControllerEquityTokenV = 0;

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
