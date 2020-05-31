pragma solidity 0.4.26;


contract ITokenholderRights {

    ////////////////////////
    // Constants
    ////////////////////////

    // number of actions declared by Action enum
    uint256 internal constant BYLAW_STRUCT_PROPS = 9;

    ////////////////////////
    // Interface Methods
    ////////////////////////

    // get bylaw for specific action
    function getBylaw(uint8 action)
        public
        constant
        returns (uint56);

    // decodes uint56 packed bylaw into uint256 array that can be casted from ActionBylaw
    function decodeBylaw(uint56 encodedBylaw)
        public
        pure
        returns (uint256[BYLAW_STRUCT_PROPS] memory decodedBylaw);
}
