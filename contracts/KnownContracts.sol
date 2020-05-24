pragma solidity 0.4.26;


/// @title known contracts of the platform
/// should be returned by contractId() method of IContradId.sol. caluclated like so: keccak256("neufund-platform:Neumark")
/// @dev constants are kept in CODE not in STORAGE so they are comparatively cheap
contract KnownContracts {

    ////////////////////////
    // Constants
    ////////////////////////

    // keccak256("neufund-platform:FeeDisbursalController")
    bytes32 internal constant FEE_DISBURSAL_CONTROLLER = 0xfc72936b568fd5fc632b76e8feac0b717b4db1fce26a1b3b623b7fb6149bd8ae;

    // keccak256("neufund-platform:IVotingController")
    bytes32 internal constant VOTING_CONTROLLER = 0xce4f452ebfdf0ed551c9b34a50b64c79ac0e36168a6215a232de447013515ac6;

}
