pragma solidity 0.4.25;


/// @title serialization of basic types from/to bytes
contract Serialization {

    ////////////////////////
    // Internal functions
    ////////////////////////
    function decodeAddress(bytes b)
        internal
        pure
        returns (address a)
    {
        require(b.length == 20);
        assembly {
            // load memory area that is address "carved out" of 64 byte bytes. prefix is zeroed
            a := and(mload(add(b, 20)), 0x00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)
        }
    }

    function decodeAddressUINT256(bytes b)
        internal
        pure
        returns (address a, uint256 i)
    {
        require(b.length == 52);
        assembly {
            // load memory area that is address "carved out" of 64 byte bytes. prefix is zeroed
            a := and(mload(add(b, 20)), 0x00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF)
            i := mload(add(b, 52))
        }
    }
}
