pragma solidity 0.4.23;


/// @title serialization of basic types from/to bytes
contract Serialization {
    ////////////////////////
    // Internal functions
    ////////////////////////
    function addressToBytes(address a)
        internal
        pure
        returns (bytes b)
    {
        assembly {
            let m := mload(0x40)
            // use unsed part of address representation to add length prefix (20) and then position it
            // so it pretends to be length prefixed 64 bytes "bytes"
            mstore(add(m, 20), xor(0x140000000000000000000000000000000000000000, a))
            mstore(0x40, add(m, 52))
            b := m
        }
    }

    function addressFromBytes(bytes b)
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
}
