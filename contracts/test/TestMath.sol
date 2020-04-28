pragma solidity 0.4.26;

import "../Math.sol";


contract TestMath {

    ////////////////////////
    // Public functions
    ////////////////////////

    function _absDiff(uint256 v1, uint256 v2)
        public
        pure
        returns(uint256)
    {
        return Math.absDiff(v1, v2);
    }

    function _divRound(uint256 v, uint256 d)
        public
        pure
        returns(uint256)
    {

        return Math.divRound(v, d);
    }

    function _decimalFraction(uint256 amount, uint256 frac)
        public
        pure
        returns(uint256)
    {
        return Math.decimalFraction(amount, frac);
    }

    function _proportion(uint256 amount, uint256 part, uint256 total)
        public
        pure
        returns(uint256)
    {
        return Math.proportion(amount, part, total);
    }

    function _min(uint256 a, uint256 b)
        public
        pure
        returns (uint256)
    {
        return Math.min(a, b);
    }

    function _max(uint256 a, uint256 b)
        public
        pure
        returns (uint256)
    {
        return Math.max(a, b);
    }
}
