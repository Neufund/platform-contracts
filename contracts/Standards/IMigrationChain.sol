pragma solidity 0.4.26;

/// @title contract upgrade pattern where all implementations are linked
/// @dev actual migration function performed in new implementation is not defined in the interface
contract IMigrationChain {

    ////////////////////////
    // Events
    ////////////////////////

    event LogMigratedTo(
        address oldImpl,
        address newImpl
    );

    ////////////////////////
    // Interface Methods
    ////////////////////////

    // start migrating actual implementation into new implementation
    function startMigrateTo(IMigrationChain newImpl)
        public;

    // finish migrating actual implemnetation into new implementation
    function finishMigrateTo(IMigrationChain newImpl)
        public;


    // address of new implementation
    /// @dev should return zero address if not migrated
    function migratedTo()
        public
        constant
        returns (IMigrationChain);

    // returns true if current implementation is being migrated to new implementation
    function isMigrating()
        public
        constant
        returns (bool);

    // link back to old implementation
    /// @dev should return zero address if is the first controller
    function migratedFrom()
        public
        constant
        returns (address);
}
