pragma solidity 0.4.25;


/// @title known contracts of the platform
/// should be returned by contractId() method of IContradId.sol. caluclated like so: keccak256("neufund-platform:Neumark")
/// @dev constants are kept in CODE not in STORAGE so they are comparatively cheap
contract KnownContracts {

    ////////////////////////
    // Constants
    ////////////////////////

    // keccak256("neufund-platform:FeeDisbursalController")
    bytes32 internal constant FEE_DISBURSAL_CONTROLLER = 0xfc72936b568fd5fc632b76e8feac0b717b4db1fce26a1b3b623b7fb6149bd8ae;

}
