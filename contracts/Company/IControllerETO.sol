pragma solidity 0.4.26;

import "../ETO/IETOCommitment.sol";


/// @title interface of governance module providing methods to start and carry on token offering
contract IControllerETO is IETOCommitmentObserver {

    ////////////////////////
    // Governance Module Id
    ////////////////////////

    bytes32 internal constant ControllerETOId = 0x1c7166c78ec7465184d422ad6e22121b4881a63128a89653179065e03625ae87;
    uint256 internal constant ControllerETOV = 0;

    ////////////////////////
    // Events
    ////////////////////////

    // offering of the token in ETO failed (Refund)
    event LogOfferingFailed(
        address etoCommitment,
        address equityToken
    );

    // offering of the token in ETO succeeded (with all on-chain consequences)
    event LogOfferingSucceeded(
        address etoCommitment,
        address equityToken,
        uint256 newShares
    );

    //
    event LogOfferingRegistered(
        bytes32 indexed resolutionId,
        address etoCommitment,
        address equityToken
    );

    ////////////////////////
    // Interface Methods
    ////////////////////////

    function tokenOfferings()
        public
        constant
        returns (
            address[] offerings
        );

    // starts new equity token offering
    function startNewOffering(bytes32 resolutionId, IETOCommitment commitment)
        public;
}
