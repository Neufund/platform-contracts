pragma solidity 0.4.23;

import "./AccessControl/AccessControlled.sol";
import "./SnapshotToken/Helpers/TokenMetadata.sol";
import "./Zeppelin/StandardToken.sol";
import "./Standards/IERC223Token.sol";
import "./Standards/IERC223Callback.sol";
import "./Standards/ITokenController.sol";
import "./IsContract.sol";
import "./AccessRoles.sol";


contract EuroToken is
    IERC677Token,
    AccessControlled,
    StandardToken,
    TokenMetadata,
    IERC223Token,
    AccessRoles,
    IsContract
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

    ITokenController private _tokenController;

    ////////////////////////
    // Events
    ////////////////////////

    /// on each deposit (increase of supply) of EUR-T
    /// 'by' indicates account that executed the deposit function for 'to' (typically bank connector)
    event LogDeposit(
        address indexed to,
        address by,
        uint256 amount
    );

    event LogWithdrawal(
        address indexed from,
        uint256 amount
    );

    /// on destroying the tokens without withdraw (see `destroyTokens` function below)
    event LogDestroy(
        address indexed from,
        address by,
        uint256 amount
    );

    event ChangeTokenController(
        address oldController,
        address newController
    );

    ////////////////////////
    // Modifiers
    ////////////////////////

    modifier onlyIfTransferAllowed(address from, address to, uint256 amount) {
        require(_tokenController.onTransfer(from, to, amount));
        _;
    }

    modifier onlyIfDepositAllowed(address to, uint256 amount) {
        require(_tokenController.onGenerateTokens(to, amount));
        _;
    }

    modifier onlyIfWithdrawAllowed(address from, uint256 amount) {
        require(_tokenController.onDestroyTokens(from, amount));
        _;
    }

    ////////////////////////
    // Constructor
    ////////////////////////

    constructor(
        IAccessPolicy accessPolicy,
        ITokenController tokenController
    )
        AccessControlled(accessPolicy)
        StandardToken()
        TokenMetadata(NAME, DECIMALS, SYMBOL, "")
        public
    {
        require(tokenController != ITokenController(0x0));
        _tokenController = tokenController;
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    /// @notice deposit 'amount' of EUR-T to address 'to'
    /// @dev deposit may happen only in case 'to' can receive transfer in token controller
    ///     by default KYC is required to receive deposits
    function deposit(address to, uint256 amount)
        public
        only(ROLE_EURT_DEPOSIT_MANAGER)
        onlyIfDepositAllowed(to, amount)
    {
        require(to != address(0));
        _balances[to] = add(_balances[to], amount);
        _totalSupply = add(_totalSupply, amount);
        emit LogDeposit(to, msg.sender, amount);
        emit Transfer(address(0), to, amount);
    }

    /// @notice withdraws 'amount' of EUR-T by burning required amount and providing a proof of whithdrawal
    /// @dev proof is provided in form of log entry. based on that proof backend will make a bank transfer
    ///     by default controller will check the following: KYC and existence of working bank account
    function withdraw(uint256 amount)
        onlyIfWithdrawAllowed(msg.sender, amount)
        public
    {
        destroyTokensPrivate(msg.sender, amount);
        emit LogWithdrawal(msg.sender, amount);
    }

    /// @notice this method allows to destroy EUR-T belonging to any account
    ///     note that EURO is fiat currency and is not trustless, EUR-T is also
    ///     just internal currency of Neufund platform, not general purpose stable coin
    ///     we need to be able to destroy EUR-T if ordered by authorities
    function destroy(address owner, uint256 amount)
        only(ROLE_EURT_LEGAL_MANAGER)
        public
    {
        destroyTokensPrivate(owner, amount);
        emit LogDestroy(owner, msg.sender, amount);
    }

    //
    // Controlls the controller
    //

    function changeTokenController(ITokenController newController)
        only(ROLE_EURT_LEGAL_MANAGER)
        public
    {
        require(newController != ITokenController(0x0));
        _tokenController = newController;
        emit ChangeTokenController(_tokenController, newController);
    }

    function tokenController()
        public
        constant
        returns (ITokenController)
    {
        return _tokenController;
    }

    //
    // Overrides ERC20 Interface to allow transfer from/to allowed addresses
    //

    function transfer(address to, uint256 amount)
        public
        onlyIfTransferAllowed(msg.sender, to, amount)
        returns (bool success)
    {
        return BasicToken.transfer(to, amount);
    }

    /// @dev broker acts in the name of 'from' address so broker needs to have permission to transfer from
    ///  this way we may give permissions to brokering smart contracts while investors do not have permissions
    ///  to transfer. 'to' address requires standard transfer to permission
    function transferFrom(address from, address to, uint256 amount)
        public
        onlyIfTransferAllowed(msg.sender, to, amount)
        returns (bool success)
    {
        // this is a kind of hack that allows special brokers to always have allowance to transfer
        // we'll use it to purchase small amount of ether by simple exchange
        if (_tokenController.hasPermanentAllowance(msg.sender, amount)) {
            transferInternal(from, to, amount);
            return true;
        }
        return StandardToken.transferFrom(from, to, amount);
    }

    //
    // Implements IERC223Token
    //

    function transfer(address to, uint256 amount, bytes data)
        public
        onlyIfTransferAllowed(msg.sender, to, amount)
        returns (bool success)
    {
        transferInternal(msg.sender, to, amount);

        // Notify the receiving contract.
        if (isContract(to)) {
            // in case of re-entry (1) transfer is done (2) msg.sender is different
            IERC223Callback(to).tokenFallback(msg.sender, amount, data);
        }
        return true;
    }

    ////////////////////////
    // Public functions
    ////////////////////////

    function destroyTokensPrivate(address owner, uint256 amount)
        private
    {
        require(_balances[msg.sender] >= amount);
        _balances[owner] = sub(_balances[owner], amount);
        _totalSupply = sub(_totalSupply, amount);
        emit Transfer(owner, address(0), amount);
    }
}
