pragma solidity 0.4.26;

import "../AccessControl/AccessControlled.sol";
import "..//Reclaimable.sol";
import "../SnapshotToken/Helpers/TokenMetadata.sol";
import "../SnapshotToken/StandardToken.sol";
import "../Standards/IWithdrawableToken.sol";
import "./MigrationSource.sol";
import "./ICBMEuroTokenMigrationTarget.sol";
import "./ICBMRoles.sol";


/// Simple implementation of EuroToken which is pegged 1:1 to certain off-chain
/// pool of Euro. Balances of this token are intended to be migrated to final
/// implementation that will be available later
contract ICBMEuroToken is
    IERC677Token,
    AccessControlled,
    StandardToken,
    IWithdrawableToken,
    TokenMetadata,
    MigrationSource,
    Reclaimable,
    ICBMRoles
{
    ////////////////////////
    // Constants
    ////////////////////////

    string private constant NAME = "Euro Token";

    string private constant SYMBOL = "EUR-T";

    uint8 private constant DECIMALS = 18;

    ////////////////////////
    // Mutable state
    ////////////////////////

    // a list of addresses that are allowed to receive EUR-T
    mapping(address => bool) private _allowedTransferTo;

    // a list of of addresses that are allowed to send EUR-T
    mapping(address => bool) private _allowedTransferFrom;

    ////////////////////////
    // Events
    ////////////////////////

    event LogDeposit(
        address indexed to,
        uint256 amount
    );

    event LogWithdrawal(
        address indexed from,
        uint256 amount
    );

    event LogAllowedFromAddress(
        address indexed from,
        bool allowed
    );

    event LogAllowedToAddress(
        address indexed to,
        bool allowed
    );

    /// @notice migration was successful
    event LogEuroTokenOwnerMigrated(
        address indexed owner,
        uint256 amount
    );

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(IAccessPolicy accessPolicy)
        StandardToken()
        TokenMetadata(NAME, DECIMALS, SYMBOL, "")
        MigrationSource(accessPolicy, ROLE_EURT_DEPOSIT_MANAGER)
        Reclaimable()
        public
    {
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice deposit 'amount' of EUR-T to address 'to'
    /// @dev address 'to' is whitelisted as recipient of future transfers
    /// @dev deposit may happen only in case of succesful KYC of recipient and validation of banking data
    /// @dev which in this implementation is an off-chain responsibility of EURT_DEPOSIT_MANAGER
    function deposit(address to, uint256 amount)
        public
        only(ROLE_EURT_DEPOSIT_MANAGER)
        returns (bool)
    {
        require(to != address(0));
        _balances[to] = add(_balances[to], amount);
        _totalSupply = add(_totalSupply, amount);
        setAllowedTransferTo(to, true);
        emit LogDeposit(to, amount);
        emit Transfer(address(0), to, amount);
        return true;
    }

    /// @notice withdraws 'amount' of EUR-T by burning required amount and providing a proof of whithdrawal
    /// @dev proof is provided in form of log entry on which EURT_DEPOSIT_MANAGER
    /// @dev will act off-chain to return required Euro amount to EUR-T holder
    function withdraw(uint256 amount)
        public
    {
        require(_balances[msg.sender] >= amount);
        _balances[msg.sender] = sub(_balances[msg.sender], amount);
        _totalSupply = sub(_totalSupply, amount);
        emit LogWithdrawal(msg.sender, amount);
        emit Transfer(msg.sender, address(0), amount);
    }

    /// @notice enables or disables address to be receipient of EUR-T
    function setAllowedTransferTo(address to, bool allowed)
        public
        only(ROLE_EURT_DEPOSIT_MANAGER)
    {
        _allowedTransferTo[to] = allowed;
        emit LogAllowedToAddress(to, allowed);
    }

    /// @notice enables or disables address to be sender of EUR-T
    function setAllowedTransferFrom(address from, bool allowed)
        public
        only(ROLE_EURT_DEPOSIT_MANAGER)
    {
        _allowedTransferFrom[from] = allowed;
        emit LogAllowedFromAddress(from, allowed);
    }

    function allowedTransferTo(address to)
        public
        constant
        returns (bool)
    {
        return _allowedTransferTo[to];
    }

    function allowedTransferFrom(address from)
        public
        constant
        returns (bool)
    {
        return _allowedTransferFrom[from];
    }

    //
    // Overrides migration source
    //

    function migrate()
        public
        onlyMigrationEnabled()
    {
        // actually needs permission to migrate
        require(_allowedTransferTo[msg.sender]);
        // burn deposit
        uint256 amount = _balances[msg.sender];
        if (amount > 0) {
            _balances[msg.sender] = 0;
            _totalSupply = sub(_totalSupply, amount);
        }
        // remove all transfer permissions
        _allowedTransferTo[msg.sender] = false;
        _allowedTransferFrom[msg.sender] = false;
        // migrate to
        ICBMEuroTokenMigrationTarget(_migration).migrateEuroTokenOwner(msg.sender, amount);
        // set event
        emit LogEuroTokenOwnerMigrated(msg.sender, amount);
    }

    ////////////////////////
    // Internal functions
    ////////////////////////

    //
    // Implements MTokenController
    //

    function mOnTransfer(
        address /*from*/,
        address to,
        uint256 /*amount*/
    )
        internal
        returns (bool allow)
    {
        // if token controller allows transfer
        return _allowedTransferFrom[msg.sender] && _allowedTransferTo[to];
    }

    function mOnApprove(
        address /*owner*/,
        address /*spender*/,
        uint256 /*amount*/
    )
        internal
        returns (bool allow)
    {
        return true;
    }
}
