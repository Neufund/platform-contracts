pragma solidity 0.4.26;

import "../SnapshotToken/StandardSnapshotToken.sol";


contract MockSnapshotIdToken is StandardSnapshotToken {

    ////////////////////////
    // Mutable state
    ////////////////////////

    // list of all known holders
    address[] private _holders;

    ////////////////////////
    // Public functions
    ////////////////////////

    function _decreaseSnapshots(uint256 delta) public {
        // decrease total supply
        shiftSnapshots(_totalSupplyValues, delta);
        // decreases snapshots for all token holders
        for(uint256 ii = 0; ii < _holders.length; ii += 1) {
            shiftSnapshots(_balances[_holders[ii]], delta);
        }
    }

    function _allHolders()
        public
        constant
        returns (address[])
    {
        return _holders;
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    //
    // Implements MTokenTransfer
    //

    function mTransfer(
        address from,
        address to,
        uint256 amount
    )
        internal
    {
        addHolder(to);
        BasicSnapshotToken.mTransfer(from, to, amount);
    }

    //
    // Implements MTokenMinst
    //

    function mGenerateTokens(address owner, uint256 amount)
        internal
    {
        addHolder(owner);
        MintableSnapshotToken.mGenerateTokens(owner, amount);
    }

    ////////////////////////
    // Private functions
    ////////////////////////

    function addHolder(address holder)
        private
    {
        // if there are no snapshots we have a new holder
        if(!hasValue(_balances[holder])) {
            _holders.push(holder);
        }
    }

    function shiftSnapshots(Values[] storage values, uint256 delta)
        private
    {
        for(uint256 ii = 0; ii < values.length; ii += 1) {
            values[ii].snapshotId -= delta;
        }
    }
}
