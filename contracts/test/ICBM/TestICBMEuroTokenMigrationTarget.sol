pragma solidity 0.4.23;

import "../../Zeppelin/StandardToken.sol";
import "../../Standards/IMigrationSource.sol";
import "../../ICBM/ICBMEuroTokenMigrationTarget.sol";


contract TestICBMEuroTokenMigrationTarget is
    StandardToken,
    ICBMEuroTokenMigrationTarget
{
    ////////////////////////
    // Immutable state
    ////////////////////////

    address private MIGRATION_SOURCE;

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(address migrationSource)
        public
    {
        MIGRATION_SOURCE = migrationSource;
    }

    ////////////////////////
    // Public Methods
    ////////////////////////

    //
    // Implements EuroTokenMigrationTarget

    function migrateEuroTokenOwner(address owner, uint256 amount)
        public
        onlyMigrationSource()
    {
        deposit(owner, amount);
    }

    //
    // Implements IMigrationTarget
    //

    function currentMigrationSource()
        public
        constant
        returns (address)
    {
        return address(MIGRATION_SOURCE);
    }

    ////////////////////////
    // Private Methods
    ////////////////////////

    function deposit(address to, uint256 amount) private {
        require(to != address(0));
        _balances[to] = add(_balances[to], amount);
        _totalSupply = add(_totalSupply, amount);
        emit Transfer(address(0), to, amount);
    }
}
